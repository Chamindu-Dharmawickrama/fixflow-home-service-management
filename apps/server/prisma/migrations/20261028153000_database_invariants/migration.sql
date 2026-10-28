-- Database invariants that the Prisma schema language cannot express: partial unique indexes and
-- CHECK constraints. They make the business rules true no matter which code path writes the data
-- (spec §11, §12.3, §15.3). Constraint names are stable on purpose: the invariant tests assert on
-- them, and API code can map a violation to a domain error by name.
--
-- Rules for this file: never edit it once applied anywhere; add a new migration instead.

-- ---------------------------------------------------------------------------------------------
-- Users (D-07, FR-032)
-- ---------------------------------------------------------------------------------------------

-- The unique index on "email" is only a case-insensitive rule if every stored value is normalized.
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_normalized_chk"
    CHECK ("email" <> '' AND "email" = lower(btrim("email"))),
  -- An account needs some way to sign in: a local password, Google, or both.
  ADD CONSTRAINT "users_credential_chk"
    CHECK ("password_hash" IS NOT NULL OR "google_subject" IS NOT NULL);

-- ---------------------------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------------------------

-- At most one default address per customer.
CREATE UNIQUE INDEX "service_addresses_one_default_per_customer_key"
  ON "service_addresses" ("customer_id")
  WHERE "is_default";

-- ---------------------------------------------------------------------------------------------
-- Business settings: exactly one row (spec §12.1)
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "business_settings"
  -- The primary key stops a second row with this id; the CHECK stops a row with any other id.
  ADD CONSTRAINT "business_settings_singleton_chk"
    CHECK ("id" = '00000000-0000-4000-8000-000000000001'),
  ADD CONSTRAINT "business_settings_currency_code_chk"
    CHECK ("currency_code" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "business_settings_tax_rate_chk"
    CHECK ("default_tax_rate" >= 0 AND "default_tax_rate" <= 100),
  ADD CONSTRAINT "business_settings_quotation_validity_days_chk"
    CHECK ("quotation_validity_days" > 0),
  ADD CONSTRAINT "business_settings_invoice_due_days_chk"
    CHECK ("invoice_due_days" >= 0);

-- ---------------------------------------------------------------------------------------------
-- Service catalogue (D-50)
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "services"
  -- A FIXED-price service is displayed as "From $X", so it must have the price.
  ADD CONSTRAINT "services_fixed_price_chk"
    CHECK ("pricing_mode" <> 'FIXED' OR "starting_price" IS NOT NULL),
  ADD CONSTRAINT "services_starting_price_chk"
    CHECK ("starting_price" IS NULL OR "starting_price" >= 0),
  ADD CONSTRAINT "services_estimated_duration_chk"
    CHECK ("estimated_duration_minutes" IS NULL OR "estimated_duration_minutes" > 0);

-- ---------------------------------------------------------------------------------------------
-- Service requests (D-35)
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "service_requests"
  ADD CONSTRAINT "service_requests_preferred_window_chk"
    CHECK ("preferred_end" > "preferred_start");

-- ---------------------------------------------------------------------------------------------
-- Quotations (BR-7, BR-8, spec §15.3)
-- ---------------------------------------------------------------------------------------------

-- Per request: one offer awaiting the customer's answer, one working draft, one accepted offer.
CREATE UNIQUE INDEX "quotations_one_sent_per_request_key"
  ON "quotations" ("request_id")
  WHERE "status" = 'SENT';

CREATE UNIQUE INDEX "quotations_one_draft_per_request_key"
  ON "quotations" ("request_id")
  WHERE "status" = 'DRAFT';

CREATE UNIQUE INDEX "quotations_one_accepted_per_request_key"
  ON "quotations" ("request_id")
  WHERE "status" = 'ACCEPTED';

ALTER TABLE "quotations"
  ADD CONSTRAINT "quotations_currency_code_chk"
    CHECK ("currency_code" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "quotations_tax_rate_chk"
    CHECK ("tax_rate" >= 0 AND "tax_rate" <= 100),
  ADD CONSTRAINT "quotations_amounts_nonnegative_chk"
    CHECK (
      "subtotal" >= 0 AND "discount_amount" >= 0 AND "taxable_base" >= 0
      AND "tax_amount" >= 0 AND "total_amount" >= 0
    ),
  ADD CONSTRAINT "quotations_discount_within_subtotal_chk"
    CHECK ("discount_amount" <= "subtotal"),
  -- Voided records stay in history with who, when and why (BR-16).
  ADD CONSTRAINT "quotations_void_audit_chk"
    CHECK ("status" <> 'VOID' OR ("voided_at" IS NOT NULL AND "void_reason" IS NOT NULL)),
  ADD CONSTRAINT "quotations_not_self_replacement_chk"
    CHECK ("replaces_quotation_id" IS NULL OR "replaces_quotation_id" <> "id");

ALTER TABLE "quotation_line_items"
  ADD CONSTRAINT "quotation_line_items_quantity_chk" CHECK ("quantity" > 0),
  ADD CONSTRAINT "quotation_line_items_unit_price_chk" CHECK ("unit_price" >= 0),
  ADD CONSTRAINT "quotation_line_items_line_subtotal_chk" CHECK ("line_subtotal" >= 0);

-- ---------------------------------------------------------------------------------------------
-- Work orders (BR-9, BR-10)
-- ---------------------------------------------------------------------------------------------

-- (One work order per quotation and per request is the unique indexes on its foreign keys.)
ALTER TABLE "work_orders"
  -- Both times are set or both are empty, and the appointment ends after it starts.
  ADD CONSTRAINT "work_orders_schedule_chk"
    CHECK (
      ("scheduled_start" IS NULL AND "scheduled_end" IS NULL)
      OR ("scheduled_start" IS NOT NULL AND "scheduled_end" IS NOT NULL
          AND "scheduled_end" > "scheduled_start")
    ),
  ADD CONSTRAINT "work_orders_cancel_audit_chk"
    CHECK ("status" <> 'CANCELLED' OR ("cancelled_at" IS NOT NULL AND "cancel_reason" IS NOT NULL));

-- ---------------------------------------------------------------------------------------------
-- Invoices and payments (BR-13…BR-15, D-26, D-27)
-- ---------------------------------------------------------------------------------------------

-- At most one live invoice per work order; after a void a new draft may be created.
CREATE UNIQUE INDEX "invoices_one_active_per_work_order_key"
  ON "invoices" ("work_order_id")
  WHERE "status" <> 'VOID';

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_currency_code_chk"
    CHECK ("currency_code" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "invoices_tax_rate_chk"
    CHECK ("tax_rate" >= 0 AND "tax_rate" <= 100),
  ADD CONSTRAINT "invoices_amounts_nonnegative_chk"
    CHECK (
      "subtotal" >= 0 AND "discount_amount" >= 0 AND "taxable_base" >= 0
      AND "tax_amount" >= 0 AND "total_amount" >= 0 AND "amount_paid" >= 0
    ),
  ADD CONSTRAINT "invoices_discount_within_subtotal_chk"
    CHECK ("discount_amount" <= "subtotal"),
  -- Recorded payments can never exceed what is owed (BR-14).
  ADD CONSTRAINT "invoices_amount_paid_within_total_chk"
    CHECK ("amount_paid" <= "total_amount"),
  ADD CONSTRAINT "invoices_due_date_chk"
    CHECK ("issue_date" IS NULL OR "due_date" IS NULL OR "due_date" >= "issue_date"),
  -- Issuing assigns the number and the dates (D-17, D-26); only drafts and voided drafts lack them.
  ADD CONSTRAINT "invoices_issued_fields_chk"
    CHECK (
      "status" IN ('DRAFT', 'VOID')
      OR ("invoice_number" IS NOT NULL AND "issued_at" IS NOT NULL
          AND "issue_date" IS NOT NULL AND "due_date" IS NOT NULL)
    ),
  ADD CONSTRAINT "invoices_void_audit_chk"
    CHECK ("status" <> 'VOID' OR ("voided_at" IS NOT NULL AND "void_reason" IS NOT NULL));

ALTER TABLE "invoice_line_items"
  ADD CONSTRAINT "invoice_line_items_quantity_chk" CHECK ("quantity" > 0),
  ADD CONSTRAINT "invoice_line_items_unit_price_chk" CHECK ("unit_price" >= 0),
  ADD CONSTRAINT "invoice_line_items_line_subtotal_chk" CHECK ("line_subtotal" >= 0);

ALTER TABLE "payment_records"
  ADD CONSTRAINT "payment_records_amount_chk" CHECK ("amount" > 0),
  -- A void records who, when and why, all together or not at all (BR-16).
  ADD CONSTRAINT "payment_records_void_audit_chk"
    CHECK (
      ("voided_at" IS NULL AND "voided_by_user_id" IS NULL AND "void_reason" IS NULL)
      OR ("voided_at" IS NOT NULL AND "voided_by_user_id" IS NOT NULL AND "void_reason" IS NOT NULL)
    );

-- ---------------------------------------------------------------------------------------------
-- Notifications, activity and references
-- ---------------------------------------------------------------------------------------------

-- A notification links to a page of this app: a path starting with a single "/", no backslash,
-- so it can never be an absolute, protocol-relative or external URL.
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_link_path_chk"
    CHECK (
      "link_path" LIKE '/%' AND "link_path" NOT LIKE '//%' AND strpos("link_path", chr(92)) = 0
    );

ALTER TABLE "activity_events"
  ADD CONSTRAINT "activity_events_metadata_object_chk"
    CHECK (jsonb_typeof("metadata") = 'object');

-- The counter starts at 1 (the first reference is ...-00001), so zero or negative is a corruption.
ALTER TABLE "reference_counters"
  ADD CONSTRAINT "reference_counters_value_chk" CHECK ("value" > 0);
