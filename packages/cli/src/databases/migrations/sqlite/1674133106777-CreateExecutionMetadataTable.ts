import { MigrationInterface, QueryRunner, Table } from 'typeorm';
import { logMigrationEnd, logMigrationStart } from '@db/utils/migrationHelpers';
import config from '@/config';

export class CreateExecutionMetadataTable1674133106777 implements MigrationInterface {
	name = 'CreateExecutionMetadataTable1674133106777';

	public async up(queryRunner: QueryRunner): Promise<void> {
		logMigrationStart(this.name);
		const tablePrefix = config.getEnv('database.tablePrefix');

		await queryRunner.query(
			`CREATE TABLE "${tablePrefix}execution_metadata" (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				executionId INTEGER NOT NULL,
				"key" TEXT,
				value TEXT,
				CONSTRAINT ${tablePrefix}execution_metadata_entity_FK FOREIGN KEY (executionId) REFERENCES ${tablePrefix}execution_entity(id) ON DELETE CASCADE
			)`,
		);

		logMigrationEnd(this.name);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		const tablePrefix = config.getEnv('database.tablePrefix');

		await queryRunner.query(`DROP TABLE "${tablePrefix}execution_metadata"`);
	}
}
