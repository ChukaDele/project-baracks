window.__ModuleLoader__.load({
  id: '@major/dsh-kernel',
  factory: function (_require) {
    var module = { exports: {} };
    /** Reconstruct the human-entered /major line from its durable command run. */
    function majorCommandText(event) {
      return `/${event.data.name}${(event.data.args ?? '').trimEnd()}`;
    }

    // This is only a projection of the upstream durable command log. The
    // upstream conversation UI continues to render the command-input node and
    // the generic command/done result; Major creates no session or UI layer.
    const majorCommandInputDefinition = {
      kind: 'major-command-input',
      target: 'chat',
      match: (event) =>
        event.type === 'command/run' && event.data.name === 'major'
          ? { id: String(event.data.commandId), role: 'start' }
          : null,
      start: (_context, match) => {
        if (match.event.type !== 'command/run') {
          throw new Error('major-command-input start requires command/run');
        }
        return {
          commandId: match.event.data.commandId,
          seq: match.event.seq,
          time: match.event.time,
          text: majorCommandText(match.event),
        };
      },
      update: (context) => context.state,
      buildViewNode: (context) => {
        if (context.state === undefined) return null;
        return {
          key: context.key,
          kind: 'command-input',
          id: context.id,
          target: 'chat',
          anchorSeq: context.state.seq - 0.1,
          location: context.start?.location ?? { kind: 'unresolved' },
          visibility: 'visible',
          data: {
            commandId: context.state.commandId,
            text: context.state.text,
            time: context.state.time,
          },
        };
      },
    };

    // Trajectory already renders tool contributions. Project the durable
    // command lifecycle into that upstream target so a restarted client shows
    // the complete Major + independent-review result without another UI.
    const majorTrajectoryDefinition = {
      kind: 'major-command-trajectory',
      target: 'trajectory',
      match: (event) => {
        if (event.type === 'command/run' && event.data.name === 'major') {
          return { id: String(event.data.commandId), role: 'start' };
        }
        if (event.type === 'command/done') {
          return { id: String(event.data.commandId), role: 'update' };
        }
        return null;
      },
      start: (_context, match) => {
        if (match.event.type !== 'command/run') {
          throw new Error('major-command-trajectory start requires command/run');
        }
        return {
          commandId: String(match.event.data.commandId),
          argsRaw: match.event.data.args ?? '',
          callTime: match.event.time,
          done: null,
        };
      },
      update: (context, match) =>
        context.state !== undefined && match.event.type === 'command/done'
          ? { ...context.state, done: match.event }
          : context.state,
      buildViewNode: (context) => {
        const state = context.state;
        const done = state?.done;
        if (state === undefined || done == null) return null;
        return {
          key: context.key,
          kind: context.kind,
          id: context.id,
          target: 'trajectory',
          anchorSeq: done.seq,
          location: context.start?.location ?? { kind: 'unresolved' },
          data: {
            kind: 'tool',
            root: {
              kind: 'tool-result',
              seq: done.seq,
              time: done.time,
              callId: state.commandId,
              call: { name: 'major', argsRaw: state.argsRaw },
              callTime: state.callTime,
              content: done.data.text ? [{ type: 'text', text: done.data.text }] : [],
              isError: done.data.kind === 'error',
              callView: null,
              resultView: null,
              subCalls: [],
            },
          },
        };
      },
    };

    module.exports = {
      inject: ['conversationEvents'],
      apply(ctx) {
        ctx.conversationEvents.register(majorCommandInputDefinition);
        ctx.conversationEvents.register(majorTrajectoryDefinition);
      },
    };
    return module.exports;
  },
});
