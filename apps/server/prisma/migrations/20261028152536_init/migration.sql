-- CreateEnum
CREATE TYPE "role" AS ENUM ('BUSINESS_ADMIN', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "pricing_mode" AS ENUM ('FIXED', 'QUOTE_REQUIRED');

-- CreateEnum
CREATE TYPE "service_request_status" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'QUOTED', 'ACCEPTED', 'DECLINED', 'CONVERTED_TO_JOB', 'CANCELLED');

-- CreateEnum
CREATE TYPE "preferred_window" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING');

-- CreateEnum
CREATE TYPE "note_visibility" AS ENUM ('INTERNAL', 'CUSTOMER_VISIBLE');

-- CreateEnum
CREATE TYPE "quotation_status" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'VOID');

-- CreateEnum
CREATE TYPE "work_order_status" AS ENUM ('PENDING_SCHEDULING', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NEEDS_RESCHEDULING');

-- CreateEnum
CREATE TYPE "invoice_status" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('CASH', 'BANK_TRANSFER', 'CARD_TERMINAL', 'CHEQUE', 'OTHER');

-- CreateEnum
CREATE TYPE "notification_type" AS ENUM ('REQUEST_RECEIVED', 'QUOTATION_ACCEPTED', 'QUOTATION_DECLINED', 'QUOTATION_SENT', 'QUOTATION_WITHDRAWN', 'REQUEST_CANCELLED', 'NOTE_ADDED', 'JOB_SCHEDULED', 'JOB_RESCHEDULED', 'JOB_NEEDS_RESCHEDULING', 'JOB_COMPLETED', 'JOB_CANCELLED', 'INVOICE_ISSUED', 'INVOICE_VOIDED', 'PAYMENT_RECORDED');

-- CreateEnum
CREATE TYPE "email_delivery_status" AS ENUM ('PENDING', 'SENT', 'LOGGED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "activity_entity_type" AS ENUM ('SERVICE_REQUEST', 'QUOTATION', 'WORK_ORDER', 'INVOICE', 'PAYMENT', 'SERVICE', 'TECHNICIAN', 'SETTINGS', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "reference_type" AS ENUM ('REQUEST', 'QUOTATION', 'WORK_ORDER', 'INVOICE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "role" "role" NOT NULL,
    "password_hash" TEXT,
    "google_subject" TEXT,
    "email_verified_at" TIMESTAMPTZ(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "terms_accepted_at" TIMESTAMPTZ(3),
    "last_sign_in_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token_hash" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "phone" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_addresses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "region" TEXT,
    "postal_code" TEXT NOT NULL,
    "access_notes" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_settings" (
    "id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid,
    "business_name" TEXT NOT NULL,
    "tagline" TEXT,
    "logo_key" TEXT,
    "logo_url" TEXT,
    "contact_email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address_line1" TEXT NOT NULL,
    "address_line2" TEXT,
    "city" TEXT NOT NULL,
    "region" TEXT,
    "postal_code" TEXT NOT NULL,
    "service_area_description" TEXT,
    "currency_code" CHAR(3) NOT NULL,
    "time_zone" TEXT NOT NULL,
    "default_tax_rate" DECIMAL(5,2) NOT NULL,
    "quotation_validity_days" INTEGER NOT NULL,
    "invoice_due_days" INTEGER NOT NULL,
    "default_quotation_terms" TEXT,
    "invoice_footer" TEXT,
    "payment_instructions" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_user_id" UUID,

    CONSTRAINT "business_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "short_description" TEXT NOT NULL,
    "full_description" TEXT NOT NULL,
    "inclusions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "estimated_duration_minutes" INTEGER,
    "pricing_mode" "pricing_mode" NOT NULL,
    "starting_price" DECIMAL(12,2),
    "image_key" TEXT,
    "image_url" TEXT,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(3),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reference" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "service_name_snapshot" TEXT NOT NULL,
    "service_address_id" UUID,
    "address_line1" TEXT NOT NULL,
    "address_line2" TEXT,
    "address_city" TEXT NOT NULL,
    "address_region" TEXT,
    "address_postal_code" TEXT NOT NULL,
    "access_notes_snapshot" TEXT,
    "description" TEXT NOT NULL,
    "preferred_date" DATE NOT NULL,
    "preferred_window" "preferred_window" NOT NULL,
    "preferred_start" TIMESTAMPTZ(3) NOT NULL,
    "preferred_end" TIMESTAMPTZ(3) NOT NULL,
    "status" "service_request_status" NOT NULL DEFAULT 'SUBMITTED',
    "cancel_reason" TEXT,
    "cancel_customer_message" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_user_id" UUID,
    "submission_key" UUID,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "request_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" "note_visibility" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reference" TEXT NOT NULL,
    "request_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "status" "quotation_status" NOT NULL DEFAULT 'DRAFT',
    "currency_code" CHAR(3) NOT NULL,
    "tax_rate" DECIMAL(5,2) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxable_base" DECIMAL(12,2) NOT NULL,
    "tax_amount" DECIMAL(12,2) NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "valid_until" DATE NOT NULL,
    "terms" TEXT,
    "customer_note" TEXT,
    "replaces_quotation_id" UUID,
    "sent_at" TIMESTAMPTZ(3),
    "sent_by_user_id" UUID,
    "responded_at" TIMESTAMPTZ(3),
    "responded_by_user_id" UUID,
    "decline_reason" TEXT,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_user_id" UUID,
    "void_reason" TEXT,
    "expired_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_line_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quotation_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "line_subtotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "quotation_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "technicians" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "specialties" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "calendar_color" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "technicians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reference" TEXT NOT NULL,
    "request_id" UUID NOT NULL,
    "quotation_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "service_name_snapshot" TEXT NOT NULL,
    "address_line1" TEXT NOT NULL,
    "address_line2" TEXT,
    "address_city" TEXT NOT NULL,
    "address_region" TEXT,
    "address_postal_code" TEXT NOT NULL,
    "access_notes_snapshot" TEXT,
    "scope_description" TEXT NOT NULL,
    "status" "work_order_status" NOT NULL DEFAULT 'PENDING_SCHEDULING',
    "scheduled_start" TIMESTAMPTZ(3),
    "scheduled_end" TIMESTAMPTZ(3),
    "technician_id" UUID,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "completion_note" TEXT,
    "internal_completion_note" TEXT,
    "cancel_reason" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_number" TEXT,
    "work_order_id" UUID NOT NULL,
    "quotation_id" UUID,
    "customer_id" UUID NOT NULL,
    "status" "invoice_status" NOT NULL DEFAULT 'DRAFT',
    "currency_code" CHAR(3) NOT NULL,
    "tax_rate" DECIMAL(5,2) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxable_base" DECIMAL(12,2) NOT NULL,
    "tax_amount" DECIMAL(12,2) NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "amount_paid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "issue_date" DATE,
    "due_date" DATE,
    "issued_at" TIMESTAMPTZ(3),
    "issued_by_user_id" UUID,
    "customer_note" TEXT,
    "business_snapshot" JSONB,
    "customer_snapshot" JSONB,
    "payment_instructions_snapshot" TEXT,
    "footer_snapshot" TEXT,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_user_id" UUID,
    "void_reason" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "line_subtotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_date" DATE NOT NULL,
    "method" "payment_method" NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "recorded_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_user_id" UUID,
    "void_reason" TEXT,

    CONSTRAINT "payment_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recipient_user_id" UUID NOT NULL,
    "type" "notification_type" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "link_path" TEXT NOT NULL,
    "entity_type" "activity_entity_type",
    "entity_id" UUID,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_delivery_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "notification_id" UUID,
    "template" TEXT NOT NULL,
    "recipient_masked" TEXT NOT NULL,
    "transport" TEXT NOT NULL,
    "status" "email_delivery_status" NOT NULL,
    "error_code" TEXT,
    "attempted_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_delivery_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_user_id" UUID,
    "entity_type" "activity_entity_type" NOT NULL,
    "entity_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT,
    "summary" TEXT NOT NULL,
    "public_summary" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "request_id" UUID,
    "customer_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference_counters" (
    "type" "reference_type" NOT NULL,
    "year" INTEGER NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "reference_counters_pkey" PRIMARY KEY ("type","year")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_subject_key" ON "users"("google_subject");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_profiles_user_id_key" ON "customer_profiles"("user_id");

-- CreateIndex
CREATE INDEX "customer_notes_customer_id_created_at_idx" ON "customer_notes"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "service_addresses_customer_id_idx" ON "service_addresses"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "services_slug_key" ON "services"("slug");

-- CreateIndex
CREATE INDEX "services_is_published_archived_at_sort_order_idx" ON "services"("is_published", "archived_at", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "service_requests_reference_key" ON "service_requests"("reference");

-- CreateIndex
CREATE INDEX "service_requests_status_submitted_at_idx" ON "service_requests"("status", "submitted_at");

-- CreateIndex
CREATE INDEX "service_requests_customer_id_idx" ON "service_requests"("customer_id");

-- CreateIndex
CREATE INDEX "service_requests_service_id_idx" ON "service_requests"("service_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_requests_customer_id_submission_key_key" ON "service_requests"("customer_id", "submission_key");

-- CreateIndex
CREATE INDEX "request_notes_request_id_created_at_idx" ON "request_notes"("request_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_reference_key" ON "quotations"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_replaces_quotation_id_key" ON "quotations"("replaces_quotation_id");

-- CreateIndex
CREATE INDEX "quotations_request_id_created_at_idx" ON "quotations"("request_id", "created_at");

-- CreateIndex
CREATE INDEX "quotations_customer_id_status_idx" ON "quotations"("customer_id", "status");

-- CreateIndex
CREATE INDEX "quotations_status_valid_until_idx" ON "quotations"("status", "valid_until");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_line_items_quotation_id_position_key" ON "quotation_line_items"("quotation_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_reference_key" ON "work_orders"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_request_id_key" ON "work_orders"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_quotation_id_key" ON "work_orders"("quotation_id");

-- CreateIndex
CREATE INDEX "work_orders_technician_id_scheduled_start_idx" ON "work_orders"("technician_id", "scheduled_start");

-- CreateIndex
CREATE INDEX "work_orders_status_scheduled_start_idx" ON "work_orders"("status", "scheduled_start");

-- CreateIndex
CREATE INDEX "work_orders_customer_id_idx" ON "work_orders"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");

-- CreateIndex
CREATE INDEX "invoices_work_order_id_idx" ON "invoices"("work_order_id");

-- CreateIndex
CREATE INDEX "invoices_customer_id_status_idx" ON "invoices"("customer_id", "status");

-- CreateIndex
CREATE INDEX "invoices_status_due_date_idx" ON "invoices"("status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_line_items_invoice_id_position_key" ON "invoice_line_items"("invoice_id", "position");

-- CreateIndex
CREATE INDEX "payment_records_invoice_id_payment_date_idx" ON "payment_records"("invoice_id", "payment_date");

-- CreateIndex
CREATE INDEX "notifications_recipient_user_id_read_at_created_at_idx" ON "notifications"("recipient_user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "email_delivery_logs_notification_id_idx" ON "email_delivery_logs"("notification_id");

-- CreateIndex
CREATE INDEX "email_delivery_logs_status_created_at_idx" ON "email_delivery_logs"("status", "created_at");

-- CreateIndex
CREATE INDEX "activity_events_entity_type_entity_id_created_at_idx" ON "activity_events"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "activity_events_request_id_created_at_idx" ON "activity_events"("request_id", "created_at");

-- CreateIndex
CREATE INDEX "activity_events_customer_id_created_at_idx" ON "activity_events"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "activity_events_created_at_idx" ON "activity_events"("created_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_addresses" ADD CONSTRAINT "service_addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_service_address_id_fkey" FOREIGN KEY ("service_address_id") REFERENCES "service_addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_notes" ADD CONSTRAINT "request_notes_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_notes" ADD CONSTRAINT "request_notes_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_replaces_quotation_id_fkey" FOREIGN KEY ("replaces_quotation_id") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_sent_by_user_id_fkey" FOREIGN KEY ("sent_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_responded_by_user_id_fkey" FOREIGN KEY ("responded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_voided_by_user_id_fkey" FOREIGN KEY ("voided_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_line_items" ADD CONSTRAINT "quotation_line_items_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "technicians"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_by_user_id_fkey" FOREIGN KEY ("issued_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_voided_by_user_id_fkey" FOREIGN KEY ("voided_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_voided_by_user_id_fkey" FOREIGN KEY ("voided_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_delivery_logs" ADD CONSTRAINT "email_delivery_logs_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
