/* sql bits and bobs */

const create_table =
    "  \
    CREATE TABLE IF NOT EXISTS [[TABLE_NAME]] (  \
      `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,  \
      `batch_id` bigint(20) unsigned DEFAULT NULL, \
      `job_type` varchar(200) NOT NULL, \
      `created_ts` datetime DEFAULT CURRENT_TIMESTAMP, \
      `started_ts` datetime DEFAULT NULL, \
      `body` varchar(10000) DEFAULT NULL, \
      `status` varchar(100) NOT NULL DEFAULT 'waiting', \
      `result` mediumtext DEFAULT NULL, \
      `recovered` tinyint(1) NOT NULL DEFAULT '0', \
      `running_time` smallint(5) unsigned DEFAULT NULL, \
      `unique_key` int(11) unsigned DEFAULT NULL, \
      `priority` bigint(20) DEFAULT NULL, \
      PRIMARY KEY (`id`), \
      UNIQUE KEY `unique_key` (`unique_key`), \
      KEY `created_ts` (`created_ts`), \
      KEY `status` (`status`), \
      KEY `locking_update` (`job_type`,`batch_id`,`status`,`priority`), \
      KEY `next_jobs_select` (`batch_id`,`priority`), \
      KEY `started_ts` (`started_ts`,`job_type`,`status`) \
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci; \
"

const delete_table = ' DROP TABLE IF EXISTS [[TABLE_NAME]] '
const select_entire_table = ' select * from [[TABLE_NAME]] '

module.exports = {
    create_table,
    delete_table,
    select_entire_table,
}
