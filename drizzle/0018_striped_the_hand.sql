PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_capability_verification_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`capability_id` text NOT NULL,
	`source_fingerprint` text NOT NULL,
	`operation` text NOT NULL,
	`fixture_json` text NOT NULL,
	`expected_json` text NOT NULL,
	`actual_json` text NOT NULL,
	`validator` text NOT NULL,
	`environment_json` text NOT NULL,
	`security_json` text NOT NULL,
	`status` text NOT NULL,
	`verification_run_id` text,
	`validation_subject` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`capability_id`) REFERENCES `capability_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`verification_run_id`) REFERENCES `verification_runs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "capability_verification_artifacts_status_valid" CHECK("status" IN ('passed', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_capability_verification_artifacts`("id", "capability_id", "source_fingerprint", "operation", "fixture_json", "expected_json", "actual_json", "validator", "environment_json", "security_json", "status", "verification_run_id", "validation_subject", "created_at") SELECT "id", "capability_id", "source_fingerprint", "operation", "fixture_json", "expected_json", "actual_json", "validator", "environment_json", "security_json", "status", "verification_run_id", 'legacy-unbound:' || "id", "created_at" FROM `capability_verification_artifacts`;
--> statement-breakpoint
DROP TABLE `capability_verification_artifacts`;--> statement-breakpoint
ALTER TABLE `__new_capability_verification_artifacts` RENAME TO `capability_verification_artifacts`;--> statement-breakpoint
CREATE INDEX `capability_verification_artifacts_capability` ON `capability_verification_artifacts` (`capability_id`);--> statement-breakpoint
UPDATE `capability_records` SET `status` = 'degraded', `validation_state` = 'failed', `verification_artifact_id` = NULL WHERE `verification_artifact_id` IN (SELECT `id` FROM `capability_verification_artifacts` WHERE `validation_subject` LIKE 'legacy-unbound:%');--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `verification_runs` ADD `validation_subject` text;
