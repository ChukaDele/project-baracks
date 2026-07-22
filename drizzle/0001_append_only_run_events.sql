-- agent_run_events is an append-only history: block UPDATE and DELETE at the DB level.
CREATE TRIGGER agent_run_events_no_update
BEFORE UPDATE ON agent_run_events
BEGIN
  SELECT RAISE(ABORT, 'agent_run_events is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER agent_run_events_no_delete
BEFORE DELETE ON agent_run_events
BEGIN
  SELECT RAISE(ABORT, 'agent_run_events is append-only');
END;
