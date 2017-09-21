/* sql methods? */

const createTable = () => {
  
}

const background_jobs_queue_schema = `
  CREATE TABLE "background_jobs_queue" (
    "id" BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
    "process_id" VARCHAR(200) NULL DEFAULT NULL,
    "job_type" VARCHAR(200) NOT NULL,
    "created_ts" DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
    "started_ts" DATETIME NULL DEFAULT NULL,
    "completed_ts" DATETIME NULL DEFAULT NULL,
    "body" VARCHAR(1000) NULL DEFAULT NULL,
    "status" VARCHAR(100) NOT NULL DEFAULT 'waiting',
    "result" VARCHAR(1000) NULL DEFAULT NULL,
    "recovered" TINYINT(1) NOT NULL DEFAULT '0',
    "running_time" INT(11) NULL DEFAULT NULL,
    PRIMARY KEY ("id"),
    UNIQUE INDEX "process_id" ("process_id"),
    INDEX "job_type" ("job_type"),
    INDEX "locking_update" ("process_id", "job_type", "status"),
    INDEX "created_ts" ("created_ts"),
    INDEX "status" ("status")
  )
  COLLATE='utf8_general_ci'
  ENGINE=InnoDB
  ;
`