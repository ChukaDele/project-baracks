import type { CapabilityCandidate } from './registry.js';
import { RUNTIME_ADAPTER_REFERENCE, runtimeAdapterRevision } from './verifier.js';

export interface DiscoveredCapability {
  candidate: CapabilityCandidate;
}

/**
 * Bounded, process-free discovery. This is deliberately a catalogue, not
 * package search: it can return only an existing Major read-only adapter.
 */
export function discoverCapabilities(input: {
  operation: string;
  repoPath: string;
}): DiscoveredCapability[] {
  void input.repoPath;
  if (input.operation !== 'canonicalize-local-path') {
    return [];
  }
  return [
    {
      candidate: {
        key: 'canonicalize-local-path',
        name: 'Canonical local path adapter',
        description: 'Canonicalizes an existing local path without mutating the repository.',
        type: 'adapter',
        operations: ['canonicalize-local-path'],
        riskLevel: 'low',
        costProfile: 'none',
        permissions: ['read local filesystem metadata'],
        source: {
          kind: 'internal_adapter',
          reference: RUNTIME_ADAPTER_REFERENCE,
          revision: runtimeAdapterRevision(),
        },
        provenance: {
          discoveredBy: 'toolsmith-local-catalog',
          evidence: 'existing Major runtime adapter is present',
        },
        preflight: {
          dependencyReviewed: true,
          permissionsReviewed: true,
          secretsSafe: true,
          telemetryReviewed: true,
          compatibilityChecked: true,
          smokeTestPassed: true,
          failureBehaviorPassed: true,
        },
      },
    },
  ];
}
