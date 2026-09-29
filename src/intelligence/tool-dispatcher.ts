import {
  DEFAULT_DECISION_CONFIDENCE,
  runDecision,
  type DecisionAdapter,
  type DecisionQuestion,
} from './decision-kernel.js';
import { redactText } from '../security/redact.js';

interface FlagArgument {
  kind: 'flag';
  description?: string | undefined;
}

type FunctionArgument = readonly string[] | FlagArgument;

function isFlagArgument(specification: FunctionArgument): specification is FlagArgument {
  return !Array.isArray(specification);
}

function allowedValues(specification: FunctionArgument): readonly string[] {
  return isFlagArgument(specification) ? ['true', 'false'] : specification;
}

export interface AllowedFunction<Name extends string = string> {
  name: Name;
  description: string;
  /** Only capabilities already validated by Toolsmith may be offered. */
  validated: true;
  arguments?: Readonly<Record<string, FunctionArgument>> | undefined;
  risk?: 'low' | 'medium' | 'high' | undefined;
}

export interface ToolSuggestion<Name extends string = string> {
  functionName: Name;
  arguments: Readonly<Record<string, string | boolean>>;
  confidence: number;
  actionable: boolean;
  requiresConfirmation: boolean;
}

export async function suggestAllowedFunction<Name extends string>(
  input: { task: string; functions: readonly AllowedFunction<Name>[] },
  options: { adapter?: DecisionAdapter; confidence?: number; telemetry?: boolean } = {},
): Promise<ToolSuggestion<Name> | undefined> {
  if (input.functions.length === 0) return undefined;
  const toolCriteria: Record<string, string> = {
    none: 'No allowlisted function is a sound match.',
  };
  input.functions.forEach((fn, index) => {
    toolCriteria[`tool_${index}`] = fn.description;
  });
  const questions: Record<string, DecisionQuestion> = {
    tool: {
      type: 'choice' as const,
      instructions: 'Select at most one allowlisted function for this task, or none.',
      criteria: toolCriteria,
    },
  };
  input.functions.forEach((fn, toolIndex) => {
    Object.entries(fn.arguments ?? {}).forEach(([argument, specification], argumentIndex) => {
      const criteria: Record<string, string> = {};
      allowedValues(specification).forEach((value, valueIndex) => {
        criteria[`value_${valueIndex}`] = value;
      });
      questions[`arg_${toolIndex}_${argumentIndex}`] = {
        type: 'choice',
        instructions: `If function ${fn.name} is selected, choose the closed-set value for argument ${argument}.`,
        criteria,
      };
    });
  });
  const result = await runDecision(
    {
      decision: 'tool-function-dispatch',
      state: {
        task: redactText(input.task),
        allowlist: input.functions.map((fn) => ({
          name: fn.name,
          description: redactText(fn.description),
          arguments: Object.fromEntries(
            Object.entries(fn.arguments ?? {}).map(([key, specification]) => [
              key,
              isFlagArgument(specification) ? { kind: 'flag' } : [...specification],
            ]),
          ),
        })),
      },
      questions,
    },
    { adapter: options.adapter, telemetry: options.telemetry },
  );
  if (!result.available) return undefined;
  const selected = result.answers.tool;
  if (selected?.type !== 'choice' || selected.choice === 'none') return undefined;
  const match = /^tool_(\d+)$/.exec(selected.choice);
  const index = match ? Number.parseInt(match[1]!, 10) : -1;
  const fn = input.functions[index];
  if (!fn) return undefined;
  const args: Record<string, string | boolean> = {};
  let confidence = selected.confidence;
  for (const [argumentIndex, [argument, specification]] of Object.entries(
    fn.arguments ?? {},
  ).entries()) {
    const answer = result.answers[`arg_${index}_${argumentIndex}`];
    if (answer?.type !== 'choice') return undefined;
    const valueMatch = /^value_(\d+)$/.exec(answer.choice);
    const valueIndex = valueMatch ? Number.parseInt(valueMatch[1]!, 10) : -1;
    const values = allowedValues(specification);
    const value = values[valueIndex];
    if (value === undefined) return undefined;
    args[argument] = isFlagArgument(specification) ? value === 'true' : value;
    confidence = Math.min(confidence, answer.confidence);
  }
  const threshold = options.confidence ?? DEFAULT_DECISION_CONFIDENCE;
  return {
    functionName: fn.name,
    arguments: args,
    confidence,
    actionable: confidence >= threshold && (fn.risk ?? 'low') === 'low',
    requiresConfirmation: (fn.risk ?? 'low') !== 'low' || confidence < threshold,
  };
}
