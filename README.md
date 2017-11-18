CAUTION: This project isn't yet ready for use by humans.



# Oxen Queue

A no-frills, high-throughput worker queue backed by MySQL.

### Features:
- Job persistence
- Job priority
- Job deduplication
- Concurrency
- Delayed jobs
- Multi-process/server operation

## Motivation
Oxen is designed to help you chew through very high numbers of jobs with significant concurrency. It is resilient to misbehaving jobs, dropped database connections, and other ills. At Opteo, we mostly use it to work though scheduled batch tasks that aren't reasonable to run in a fat Promise.all().

There are already several great libraries out there, but for our purposes they struggled with a high number of jobs (Agenda), or had issues with race conditions (Kue, Bull).

You'll be happy with Oxen if you:
- Have many, many jobs (millions per day isn't unreasonable)
- You're more interested in throughput than latency when it comes to job completion
- You appreciate the value of a queriable queue in your SQL client of choice

Oxen isn't for you if:
- You need retry mechanisms for failed jobs
- Your jobs are user-facing and need to start in sub-second latencies
- You need a UI, and you don't want to hack something together yourself
- Using MySQL for a queue makes you feel icky


## Installation

*Infrastructure Requirements*:

- Node 7 or higher
- MySQL

*npm*

To install via npm, run:
 ```bash
npm install oxen-queue
```

*Creating your queue table*

Oxen-queue runs off of a single MySQL table, not matter how many queues you have. It's up to you to create it. Here's how:

```sql
CREATE TABLE `<YOUR_TABLE_NAME_HERE>` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `batch_id` bigint(20) unsigned DEFAULT NULL,
  `job_type` varchar(200) NOT NULL,
  `created_ts` datetime DEFAULT CURRENT_TIMESTAMP,
  `started_ts` datetime DEFAULT NULL,
  `body` varchar(1000) DEFAULT NULL,
  `status` varchar(100) NOT NULL DEFAULT 'waiting',
  `result` varchar(1000) DEFAULT NULL,
  `recovered` tinyint(1) NOT NULL DEFAULT '0',
  `running_time` smallint(5) unsigned DEFAULT NULL,
  `unique_key` int(11) unsigned DEFAULT NULL,
  `priority` bigint(20) DEFAULT NULL,
  `task_type` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_key` (`unique_key`),
  KEY `created_ts` (`created_ts`),
  KEY `status` (`status`),
  KEY `task_type` (`task_type`),
  KEY `locking_update_v2` (`job_type`,`batch_id`,`status`,`priority`),
  KEY `next_jobs_select` (`batch_id`,`priority`),
  KEY `started_ts` (`started_ts`,`job_type`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
```

TO BE CONTINUED
