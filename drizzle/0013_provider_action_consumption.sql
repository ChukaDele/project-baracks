CREATE TABLE `provider_action_consumptions` (
  `id` text PRIMARY KEY NOT NULL,
  `decision_id` text NOT NULL UNIQUE REFERENCES `decision_requests`(`id`),
  `consumer_id` text NOT NULL UNIQUE,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
