-- AlterTable
ALTER TABLE "job_reports" ADD COLUMN     "source_retention_until" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "job_reports_retention_until_is_deleted_idx" ON "job_reports"("retention_until", "is_deleted");

-- CreateIndex
CREATE INDEX "job_reports_source_retention_until_is_deleted_idx" ON "job_reports"("source_retention_until", "is_deleted");

-- CreateIndex
CREATE INDEX "hr_analyses_retention_until_is_deleted_idx" ON "hr_analyses"("retention_until", "is_deleted");

-- CreateIndex
CREATE INDEX "interview_feedbacks_visitor_id_idx" ON "interview_feedbacks"("visitor_id");

-- CreateIndex
CREATE INDEX "interview_feedbacks_retention_until_is_deleted_idx" ON "interview_feedbacks"("retention_until", "is_deleted");

-- CreateIndex
CREATE INDEX "report_feedbacks_visitor_id_idx" ON "report_feedbacks"("visitor_id");

-- CreateIndex
CREATE INDEX "report_feedbacks_retention_until_is_deleted_idx" ON "report_feedbacks"("retention_until", "is_deleted");

-- Backfill retention deadlines for records created before lifecycle enforcement.
UPDATE "job_reports"
SET "source_retention_until" = "created_at" + INTERVAL '7 days'
WHERE "source_retention_until" IS NULL AND "is_deleted" = false;

UPDATE "job_reports"
SET "retention_until" = "created_at" + INTERVAL '30 days'
WHERE "retention_until" IS NULL AND "is_deleted" = false;

UPDATE "hr_analyses"
SET "retention_until" = "created_at" + INTERVAL '30 days'
WHERE "retention_until" IS NULL AND "is_deleted" = false;

UPDATE "interview_feedbacks"
SET "retention_until" = "created_at" + INTERVAL '90 days'
WHERE "retention_until" IS NULL AND "is_deleted" = false;

UPDATE "report_feedbacks"
SET "retention_until" = "created_at" + INTERVAL '90 days'
WHERE "retention_until" IS NULL AND "is_deleted" = false;
