-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "job_reports" (
    "id" VARCHAR(50) NOT NULL,
    "report_id" VARCHAR(50) NOT NULL,
    "source_platform" VARCHAR(30),
    "company_name" VARCHAR(80),
    "job_title" VARCHAR(80),
    "jd_text" TEXT NOT NULL,
    "hr_chat_text" TEXT,
    "input_hash" VARCHAR(64) NOT NULL,
    "visitor_id" VARCHAR(50),
    "ip_address" VARCHAR(45),
    "overall_score" INTEGER NOT NULL,
    "risk_level" VARCHAR(10) NOT NULL,
    "confidence" VARCHAR(10) NOT NULL,
    "predicted_role" VARCHAR(100),
    "risk_types" JSONB NOT NULL,
    "sub_scores" JSONB NOT NULL,
    "strong_risk_adjustment" INTEGER NOT NULL DEFAULT 0,
    "evidence" JSONB NOT NULL,
    "missing_info" JSONB NOT NULL,
    "questions" JSONB NOT NULL,
    "recommendation" VARCHAR(200) NOT NULL,
    "disclaimer" VARCHAR(100) NOT NULL,
    "analysis_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "provider" VARCHAR(50),
    "model" VARCHAR(50),
    "model_version" VARCHAR(20),
    "prompt_version" VARCHAR(20),
    "schema_version" VARCHAR(20) NOT NULL DEFAULT 'v1.0.0',
    "latency_ms" INTEGER,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cost_estimate" DECIMAL(10,6),
    "retention_until" TIMESTAMP(3),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_analyses" (
    "id" VARCHAR(50) NOT NULL,
    "hr_analysis_id" VARCHAR(50) NOT NULL,
    "report_id" VARCHAR(50),
    "user_question" VARCHAR(500) NOT NULL,
    "hr_reply" VARCHAR(2000) NOT NULL,
    "jd_context" VARCHAR(2000),
    "visitor_id" VARCHAR(50),
    "ip_address" VARCHAR(45),
    "avoidance_score" INTEGER NOT NULL,
    "risk_level" VARCHAR(10) NOT NULL,
    "analysis" VARCHAR(500) NOT NULL,
    "next_questions" JSONB NOT NULL,
    "analysis_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "provider" VARCHAR(50),
    "model" VARCHAR(50),
    "model_version" VARCHAR(20),
    "prompt_version" VARCHAR(20),
    "schema_version" VARCHAR(20) NOT NULL DEFAULT 'v1.0.0',
    "latency_ms" INTEGER,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cost_estimate" DECIMAL(10,6),
    "retention_until" TIMESTAMP(3),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interview_feedbacks" (
    "id" VARCHAR(50) NOT NULL,
    "feedback_id" VARCHAR(50) NOT NULL,
    "report_id" VARCHAR(50),
    "company_name" VARCHAR(80) NOT NULL,
    "job_title" VARCHAR(80) NOT NULL,
    "source_platform" VARCHAR(30),
    "jd_claim" VARCHAR(500) NOT NULL,
    "interview_actual" VARCHAR(2000) NOT NULL,
    "involves_sales" BOOLEAN NOT NULL,
    "involves_fee" BOOLEAN NOT NULL,
    "involves_training_loan" BOOLEAN NOT NULL,
    "involves_deposit" BOOLEAN NOT NULL,
    "subject_mismatch" BOOLEAN NOT NULL,
    "recommend_to_others" VARCHAR(10) NOT NULL,
    "visitor_id" VARCHAR(50),
    "ip_address" VARCHAR(45),
    "review_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "reviewed_at" TIMESTAMP(3),
    "reviewer_note" VARCHAR(500),
    "retention_until" TIMESTAMP(3),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interview_feedbacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_feedbacks" (
    "id" VARCHAR(50) NOT NULL,
    "feedback_id" VARCHAR(50) NOT NULL,
    "report_id" VARCHAR(50) NOT NULL,
    "feedback_type" VARCHAR(30) NOT NULL,
    "content" VARCHAR(2000) NOT NULL,
    "visitor_id" VARCHAR(50),
    "ip_address" VARCHAR(45),
    "review_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "reviewed_at" TIMESTAMP(3),
    "reviewer_note" VARCHAR(500),
    "retention_until" TIMESTAMP(3),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_feedbacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_logs" (
    "id" VARCHAR(50) NOT NULL,
    "request_id" VARCHAR(50) NOT NULL,
    "api_path" VARCHAR(100) NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "visitor_id" VARCHAR(50),
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(200),
    "http_status" INTEGER NOT NULL,
    "error_code" VARCHAR(30),
    "error_message" VARCHAR(500),
    "ai_called" BOOLEAN NOT NULL DEFAULT false,
    "provider" VARCHAR(50),
    "model" VARCHAR(50),
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "latency_ms" INTEGER,
    "cost_estimate" DECIMAL(10,6),
    "rate_limited" BOOLEAN NOT NULL DEFAULT false,
    "captcha_required" BOOLEAN NOT NULL DEFAULT false,
    "captcha_passed" BOOLEAN NOT NULL DEFAULT false,
    "request_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "response_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_events" (
    "id" VARCHAR(50) NOT NULL,
    "event_type" VARCHAR(30) NOT NULL,
    "severity" VARCHAR(10) NOT NULL,
    "visitor_id" VARCHAR(50),
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(200),
    "api_path" VARCHAR(100),
    "request_id" VARCHAR(50),
    "detail" JSONB,
    "action_taken" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_reports_report_id_key" ON "job_reports"("report_id");

-- CreateIndex
CREATE INDEX "job_reports_report_id_idx" ON "job_reports"("report_id");

-- CreateIndex
CREATE INDEX "job_reports_input_hash_idx" ON "job_reports"("input_hash");

-- CreateIndex
CREATE INDEX "job_reports_visitor_id_idx" ON "job_reports"("visitor_id");

-- CreateIndex
CREATE INDEX "job_reports_created_at_idx" ON "job_reports"("created_at");

-- CreateIndex
CREATE INDEX "job_reports_is_deleted_idx" ON "job_reports"("is_deleted");

-- CreateIndex
CREATE UNIQUE INDEX "hr_analyses_hr_analysis_id_key" ON "hr_analyses"("hr_analysis_id");

-- CreateIndex
CREATE INDEX "hr_analyses_hr_analysis_id_idx" ON "hr_analyses"("hr_analysis_id");

-- CreateIndex
CREATE INDEX "hr_analyses_report_id_idx" ON "hr_analyses"("report_id");

-- CreateIndex
CREATE INDEX "hr_analyses_visitor_id_idx" ON "hr_analyses"("visitor_id");

-- CreateIndex
CREATE INDEX "hr_analyses_created_at_idx" ON "hr_analyses"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "interview_feedbacks_feedback_id_key" ON "interview_feedbacks"("feedback_id");

-- CreateIndex
CREATE INDEX "interview_feedbacks_feedback_id_idx" ON "interview_feedbacks"("feedback_id");

-- CreateIndex
CREATE INDEX "interview_feedbacks_report_id_idx" ON "interview_feedbacks"("report_id");

-- CreateIndex
CREATE INDEX "interview_feedbacks_company_name_idx" ON "interview_feedbacks"("company_name");

-- CreateIndex
CREATE INDEX "interview_feedbacks_created_at_idx" ON "interview_feedbacks"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "report_feedbacks_feedback_id_key" ON "report_feedbacks"("feedback_id");

-- CreateIndex
CREATE INDEX "report_feedbacks_feedback_id_idx" ON "report_feedbacks"("feedback_id");

-- CreateIndex
CREATE INDEX "report_feedbacks_report_id_idx" ON "report_feedbacks"("report_id");

-- CreateIndex
CREATE INDEX "report_feedbacks_created_at_idx" ON "report_feedbacks"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "api_logs_request_id_key" ON "api_logs"("request_id");

-- CreateIndex
CREATE INDEX "api_logs_request_id_idx" ON "api_logs"("request_id");

-- CreateIndex
CREATE INDEX "api_logs_api_path_idx" ON "api_logs"("api_path");

-- CreateIndex
CREATE INDEX "api_logs_visitor_id_idx" ON "api_logs"("visitor_id");

-- CreateIndex
CREATE INDEX "api_logs_ip_address_idx" ON "api_logs"("ip_address");

-- CreateIndex
CREATE INDEX "api_logs_request_at_idx" ON "api_logs"("request_at");

-- CreateIndex
CREATE INDEX "api_logs_http_status_idx" ON "api_logs"("http_status");

-- CreateIndex
CREATE INDEX "security_events_event_type_idx" ON "security_events"("event_type");

-- CreateIndex
CREATE INDEX "security_events_visitor_id_idx" ON "security_events"("visitor_id");

-- CreateIndex
CREATE INDEX "security_events_ip_address_idx" ON "security_events"("ip_address");

-- CreateIndex
CREATE INDEX "security_events_created_at_idx" ON "security_events"("created_at");
