-- ============================================================================
-- The shape of the LabStack tables Atlas reads — for local development only.
--
-- In production these are foreign tables (postgres_fdw) pointing at a
-- read-only replica of the LabStack operational database, snapshotted nightly
-- into src_local by scripts/refresh-data.sh. A developer working on Atlas has
-- no access to that replica and should not need it: the analytics views only
-- ever read src_local, so a local machine can put its own rows there and every
-- view, page and query behaves exactly as it does in production.
--
-- Structure only. Not one row of LabStack data is in this repository — the
-- sample rows live in 02_source_seed.sql and are invented.
--
-- The column list is dumped from a real atlas-db so the types match what the
-- views expect. NOT NULL is dropped at the end: the seed fills the columns
-- Atlas actually reads and leaves the other two hundred alone.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS src_local;

-- ---- Enum types -----------------------------------------------------------
-- The views cast several of these to text and compare against literals, so the
-- labels have to match the source database exactly.
DROP TYPE IF EXISTS public."AlertChannel" CASCADE;
CREATE TYPE public."AlertChannel" AS ENUM ('IN_APP', 'WHATSAPP', 'EMAIL');
DROP TYPE IF EXISTS public."AlertStatus" CASCADE;
CREATE TYPE public."AlertStatus" AS ENUM ('PENDING', 'SENT', 'ACKNOWLEDGED', 'FAILED');
DROP TYPE IF EXISTS public."AlertType" CASCADE;
CREATE TYPE public."AlertType" AS ENUM ('SLA_WARNING', 'SLA_URGENT', 'SLA_BREACHED', 'TASK_UNASSIGNED', 'AGENT_AT_CAPACITY', 'ORDER_STUCK', 'SKILL_GAP', 'DAILY_SUMMARY', 'ESCALATION');
DROP TYPE IF EXISTS public."AppointmentStatus" CASCADE;
CREATE TYPE public."AppointmentStatus" AS ENUM ('PENDING', 'CREATED', 'CONFIRMED', 'RESCHEDULED', 'CANCELED', 'COMPLETED', 'CHECKED_IN', 'DELAYED');
DROP TYPE IF EXISTS public."AppointmentType" CASCADE;
CREATE TYPE public."AppointmentType" AS ENUM ('ONLINE', 'CENTER_VISIT', 'HOME_VISIT');
DROP TYPE IF EXISTS public."AssignmentMethod" CASCADE;
CREATE TYPE public."AssignmentMethod" AS ENUM ('AUTO', 'MANUAL');
DROP TYPE IF EXISTS public."AuditEntity" CASCADE;
CREATE TYPE public."AuditEntity" AS ENUM ('SYSTEM', 'USER', 'RAZORPAY_WEBHOOK');
DROP TYPE IF EXISTS public."CallSource" CASCADE;
CREATE TYPE public."CallSource" AS ENUM ('EXOTEL', 'AI_BOT', 'TWILIO', 'SIP');
DROP TYPE IF EXISTS public."CallStatus" CASCADE;
CREATE TYPE public."CallStatus" AS ENUM ('INITIATED', 'PICKED_UP', 'RNR', 'COMPLETED', 'FAILED', 'BUSY', 'NO_ANSWER');
DROP TYPE IF EXISTS public."CampStatus" CASCADE;
CREATE TYPE public."CampStatus" AS ENUM ('ONGOING', 'COMPLETED', 'REPORTS_DELIVERED', 'CANCELLED');
DROP TYPE IF EXISTS public."CenterType" CASCADE;
CREATE TYPE public."CenterType" AS ENUM ('HOSPITAL', 'COLLECTION_CENTER', 'DIAGNOSTIC_CENTER');
DROP TYPE IF EXISTS public."ChangeEntityType" CASCADE;
CREATE TYPE public."ChangeEntityType" AS ENUM ('USER', 'LAB_WEBHOOK', 'STORE', 'SYSTEM');
DROP TYPE IF EXISTS public."Clarity" CASCADE;
CREATE TYPE public."Clarity" AS ENUM ('TWO_D', 'THREE_D', 'FOUR_D', 'HR');
DROP TYPE IF EXISTS public."CommunicationSource" CASCADE;
CREATE TYPE public."CommunicationSource" AS ENUM ('INTERAKT', 'META');
DROP TYPE IF EXISTS public."CommunicationType" CASCADE;
CREATE TYPE public."CommunicationType" AS ENUM ('MISSED_CALL');
DROP TYPE IF EXISTS public."DayOfWeek" CASCADE;
CREATE TYPE public."DayOfWeek" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');
DROP TYPE IF EXISTS public."DiscountType" CASCADE;
CREATE TYPE public."DiscountType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT', 'BUY_X_GET_Y');
DROP TYPE IF EXISTS public."DocumentType" CASCADE;
CREATE TYPE public."DocumentType" AS ENUM ('PRESCRIPTION', 'REFERRAL');
DROP TYPE IF EXISTS public."DrugDosageForm" CASCADE;
CREATE TYPE public."DrugDosageForm" AS ENUM ('TABLET', 'CAPSULE', 'SYRUP', 'INJECTION', 'CREAM', 'OINTMENT', 'GEL', 'DROPS', 'INHALER', 'PATCH', 'POWDER', 'GRANULES', 'LOZENGE', 'SPRAY', 'SUPPOSITORY', 'SUSPENSION', 'EMULSION', 'LOTION', 'SOLUTION', 'ELIXIR', 'MOUTHWASH', 'ENEMA', 'OTHER');
DROP TYPE IF EXISTS public."DrugDosageRoute" CASCADE;
CREATE TYPE public."DrugDosageRoute" AS ENUM ('ORAL', 'SUBLINGUAL', 'BUCCAL', 'RECTAL', 'NASOGASTRIC', 'GASTROSTOMY', 'INTRAVENOUS', 'INTRAMUSCULAR', 'SUBCUTANEOUS', 'INTRADERMAL', 'INTRA_ARTERIAL', 'INTRA_ARTICULAR', 'INTRATHECAL', 'EPIDURAL', 'INTRAPERITONEAL', 'INTRAOSSEOUS', 'INTRACARDIAC', 'INHALATION', 'INTRANASAL', 'DERMAL', 'TRANSDERMAL', 'OCULAR', 'OTIC', 'VAGINAL', 'URETHRAL', 'INTRAVITREAL', 'INTRACAVITARY', 'INTRAVESICAL', 'IMPLANT', 'INTRAUTERINE', 'OTHER');
DROP TYPE IF EXISTS public."EntityType" CASCADE;
CREATE TYPE public."EntityType" AS ENUM ('LABSTACK', 'STORE', 'LAB', 'USER', 'PROVIDER', 'PHARMACY');
DROP TYPE IF EXISTS public."FeedbackType" CASCADE;
CREATE TYPE public."FeedbackType" AS ENUM ('SAMPLE_COLLECTION', 'ORDER_COMPLETE');
DROP TYPE IF EXISTS public."Gender" CASCADE;
CREATE TYPE public."Gender" AS ENUM ('MALE', 'FEMALE', 'OTHERS');
DROP TYPE IF EXISTS public."InvoicePaymentStatus" CASCADE;
CREATE TYPE public."InvoicePaymentStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID');
DROP TYPE IF EXISTS public."LabAPIProvider" CASCADE;
CREATE TYPE public."LabAPIProvider" AS ENUM ('NO_PROVIDER', 'ORANGE_HEALTH', 'REDCLIFFE', 'HEALTHIANS', 'THYROCARE', 'ONE_MG', 'AGILUS', 'METROPOLIS', 'APOLLO', 'NEUBERG', 'THYROCARE_V2');
DROP TYPE IF EXISTS public."LabPaymentType" CASCADE;
CREATE TYPE public."LabPaymentType" AS ENUM ('B2B', 'L2L');
DROP TYPE IF EXISTS public."LabPaymentTypeConfig" CASCADE;
CREATE TYPE public."LabPaymentTypeConfig" AS ENUM ('B2B_ONLY', 'B2B_DEFAULT', 'L2L_ONLY', 'L2L_DEFAULT');
DROP TYPE IF EXISTS public."LabPdfEditService" CASCADE;
CREATE TYPE public."LabPdfEditService" AS ENUM ('NO_PROVIDER', 'SERVOCURE');
DROP TYPE IF EXISTS public."LlmProviderType" CASCADE;
CREATE TYPE public."LlmProviderType" AS ENUM ('OLLAMA', 'VERTEX_AI', 'GEMINI', 'OPENAI');
DROP TYPE IF EXISTS public."OrderPaymentLinkEventType" CASCADE;
CREATE TYPE public."OrderPaymentLinkEventType" AS ENUM ('CREATED', 'SENT_EMAIL', 'SENT_WHATSAPP', 'REFRESHED', 'WEBHOOK_RECEIVED', 'PAID', 'EXPIRED', 'CANCELLED', 'FAILED');
DROP TYPE IF EXISTS public."OrderStatus" CASCADE;
CREATE TYPE public."OrderStatus" AS ENUM ('PENDING', 'CREATED', 'ORDER_SCHEDULED', 'PHLEBO_ASSIGNED', 'SAMPLE_COLLECTED', 'SAMPLE_DELIVERED', 'SAMPLE_PROCESSED', 'REPORT_DELIVERED', 'RESCHEDULED', 'CANCELED', 'PATIENT_MISSED', 'PATIENT_VISITED', 'KIT_DISPATCHED');
DROP TYPE IF EXISTS public."OrderType" CASCADE;
CREATE TYPE public."OrderType" AS ENUM ('HOME_SAMPLE', 'CENTER_VISIT', 'CAMP', 'KIT_BASED');
DROP TYPE IF EXISTS public."ParticipantType" CASCADE;
CREATE TYPE public."ParticipantType" AS ENUM ('MAIN_PARTICIPANT', 'ADDITIONAL_PARTICIPANT', 'PROVIDER');
DROP TYPE IF EXISTS public."PaymentCollector" CASCADE;
CREATE TYPE public."PaymentCollector" AS ENUM ('STORE', 'LABSTACK');
DROP TYPE IF EXISTS public."PaymentCollectorConfig" CASCADE;
CREATE TYPE public."PaymentCollectorConfig" AS ENUM ('STORE_ONLY', 'STORE_DEFAULT', 'LABSTACK_ONLY', 'LABSTACK_DEFAULT');
DROP TYPE IF EXISTS public."PaymentLinkChannel" CASCADE;
CREATE TYPE public."PaymentLinkChannel" AS ENUM ('EMAIL', 'WHATSAPP');
DROP TYPE IF EXISTS public."PaymentLinkStatus" CASCADE;
CREATE TYPE public."PaymentLinkStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'CANCELLED', 'FAILED');
DROP TYPE IF EXISTS public."PaymentMode" CASCADE;
CREATE TYPE public."PaymentMode" AS ENUM ('CASH', 'CHEQUE', 'IMPS', 'NEFT', 'RTGS', 'UPI', 'CREDIT_CARD', 'DEBIT_CARD', 'NET_BANKING');
DROP TYPE IF EXISTS public."PaymentPolicy" CASCADE;
CREATE TYPE public."PaymentPolicy" AS ENUM ('TRANSFER_PRICE', 'COMMISSION');
DROP TYPE IF EXISTS public."PaymentStatus" CASCADE;
CREATE TYPE public."PaymentStatus" AS ENUM ('IDLE', 'PENDING', 'COMPLETED', 'CANCELLED');
DROP TYPE IF EXISTS public."PaymentTerms" CASCADE;
CREATE TYPE public."PaymentTerms" AS ENUM ('PREPAID', 'POSTPAID');
DROP TYPE IF EXISTS public."PaymentVia" CASCADE;
CREATE TYPE public."PaymentVia" AS ENUM ('GOOGLE_BUSINESS', 'HDFC_VYAPAAR', 'DIRECT_ACCOUNT', 'RAZORPAY');
DROP TYPE IF EXISTS public."PharmaOrderStatus" CASCADE;
CREATE TYPE public."PharmaOrderStatus" AS ENUM ('PLACED', 'CREATED', 'CONFIRMED', 'PARTIAL_DELIVERED', 'FULL_DELIVERED', 'CANCELLED', 'SHIPPED');
DROP TYPE IF EXISTS public."PharmaOrderType" CASCADE;
CREATE TYPE public."PharmaOrderType" AS ENUM ('HOME_DELIVERY', 'PICKUP');
DROP TYPE IF EXISTS public."PocType" CASCADE;
CREATE TYPE public."PocType" AS ENUM ('MANAGEMENT', 'RECEPTION', 'FINANCE', 'PHLEBOTOMIST', 'OTHERS');
DROP TYPE IF EXISTS public."Priority" CASCADE;
CREATE TYPE public."Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
DROP TYPE IF EXISTS public."ProcedureType" CASCADE;
CREATE TYPE public."ProcedureType" AS ENUM ('ROUTINE', 'NON_ROUTINE');
DROP TYPE IF EXISTS public."QuotationType" CASCADE;
CREATE TYPE public."QuotationType" AS ENUM ('PACKAGE', 'CAMP');
DROP TYPE IF EXISTS public."Relationship" CASCADE;
CREATE TYPE public."Relationship" AS ENUM ('HUSBAND', 'WIFE', 'FATHER', 'MOTHER', 'SON', 'DAUGHTER', 'GRANDFATHER', 'GRANDMOTHER', 'GRANDSON', 'GRANDDAUGHTER', 'SON_IN_LAW', 'DAUGHTER_IN_LAW', 'BROTHER', 'SISTER', 'BROTHER_IN_LAW', 'SISTER_IN_LAW', 'UNCLE', 'AUNT', 'COUSIN', 'NEPHEW', 'NIECE', 'MOTHER_IN_LAW', 'FATHER_IN_LAW', 'PARTNER', 'OTHER', 'FRIEND', 'NEIGHBOUR');
DROP TYPE IF EXISTS public."ReportStatus" CASCADE;
CREATE TYPE public."ReportStatus" AS ENUM ('PARTIAL', 'FULL');
DROP TYPE IF EXISTS public."RequestSource" CASCADE;
CREATE TYPE public."RequestSource" AS ENUM ('STORE', 'LABSTACK', 'WEBSITE', 'QR_CODE', 'SOCIAL_MEDIA', 'OTHER', 'STORE_API', 'EKACARE');
DROP TYPE IF EXISTS public."RequestStatus" CASCADE;
CREATE TYPE public."RequestStatus" AS ENUM ('OPEN', 'QUOTED', 'ORDERED', 'QUOTATION_REJECTED', 'CANCELLED', 'QUOTATION_ACCEPTED', 'NON_SERVICEABLE', 'DENIED', 'DISCHARGED', 'UNREACHABLE', 'WRONG_NUMBER', 'CONSENTED');
DROP TYPE IF EXISTS public."Role" CASCADE;
CREATE TYPE public."Role" AS ENUM ('ADMINISTRATOR', 'OPERATIONS', 'STORE_ADMIN', 'STORE_OPERATIONS', 'USER', 'LAB_ADMIN', 'PROVIDER_ADMIN', 'PHARMACY_ADMIN', 'PHARMACY_OPERATIONS', 'LAB_OPERATIONS');
DROP TYPE IF EXISTS public."RosterStatus" CASCADE;
CREATE TYPE public."RosterStatus" AS ENUM ('ON_DUTY', 'OFF_SHIFT', 'ON_LEAVE');
DROP TYPE IF EXISTS public."ScanView" CASCADE;
CREATE TYPE public."ScanView" AS ENUM ('AP', 'LAT', 'OBL', 'PA', 'AXIAL', 'MERCHANT', 'OPEN_MOUTH', 'STANDING', 'SUPINE', 'TOWNE', 'LIMITED', 'SCREENING', 'ONE_SITTING', 'TWO_SITTINGS', 'THREE_SITTINGS');
DROP TYPE IF EXISTS public."ScheduleType" CASCADE;
CREATE TYPE public."ScheduleType" AS ENUM ('SCHEDULE_H', 'SCHEDULE_X', 'SCHEDULE_C', 'SCHEDULE_E', 'GENERAL_OTC');
DROP TYPE IF EXISTS public."SelectionMode" CASCADE;
CREATE TYPE public."SelectionMode" AS ENUM ('WHITELIST', 'BLACKLIST');
DROP TYPE IF EXISTS public."Source" CASCADE;
CREATE TYPE public."Source" AS ENUM ('CONSOLE_ORDER_ADD', 'CONSOLE_CAMP_BULK', 'CONSOLE_EXCEL_IMPORT', 'STORE_API', 'SELF_ORDER');
DROP TYPE IF EXISTS public."SpecialTechnique" CASCADE;
CREATE TYPE public."SpecialTechnique" AS ENUM ('BARIUM_ENEMA', 'BARIUM_FOLLOW_THROUGH', 'BARIUM_MEAL', 'BARIUM_SWALLOW', 'BONE_AGE', 'CEPHALOGRAM', 'DACRYOCYSTOGRAM', 'HSG', 'INTRAVENOUS_PYELOGRAM', 'MAMMOGRAM', 'MICTURATING_CYSTOURETHOGRAM', 'MODIFIED_BARIUM_SWALLOW', 'OPG', 'RETROGRADE_URETHROGRAM', 'SIALOGRAM', 'ANGIOGRAM', 'BRONCHOSCOPY', 'CALCIUM_SCORING', 'CBCT', 'CISTERNOGRAPHY', 'COLONOSCOPY', 'ENTEROCLYSIS', 'ENTEROGRAPHY', 'FISTULOGRAM', 'FNAC', 'PERFUSION_IMAGING', 'SCANOGRAM', 'SINOGRAM', 'TRIPHASIC', 'VENOGRAM', 'ARTHROGRAM', 'CARTIGRAM', 'CSF_FLOW', 'DIFFUSION_IMAGING', 'DYNAMIC', 'MORPHOLOGY', 'MRCP_SCAN', 'NEUROGRAPHY', 'SPECTROSCOPY', 'TOF_ANGIOGRAPHY', 'TRACTOGRAPHY', 'AMNIOTIC_FLUID_INDEX', 'ANOMALY_SCAN', 'ANTENATAL_SCAN', 'ARTERIAL_DOPPLER', 'COLOR_DOPPLER', 'DOPPLER', 'ECHO_CARDIOGRAM', 'FOLLICULAR_STUDY', 'FOLLOW_THROUGH', 'INTERVAL_GROWTH_SCAN', 'NEURO_SONOGRAM', 'NT_SCAN', 'OBSTETRIC_DOPPLER', 'PERFORATOR_MARKING', 'ROUTINE_OBSTETRIC', 'SALINE_SONOGRAPHY', 'TRANSCRANIAL_DOPPLER', 'TRUS', 'TVS', 'VENOUS_DOPPLER');
DROP TYPE IF EXISTS public."StandardTestRangeColor" CASCADE;
CREATE TYPE public."StandardTestRangeColor" AS ENUM ('GREEN', 'YELLOW', 'RED');
DROP TYPE IF EXISTS public."StandardTestRangeDemographic" CASCADE;
CREATE TYPE public."StandardTestRangeDemographic" AS ENUM ('NONE', 'GENDER', 'AGE_BRACKET');
DROP TYPE IF EXISTS public."StandardTestRangeDemographicValue" CASCADE;
CREATE TYPE public."StandardTestRangeDemographicValue" AS ENUM ('MALE', 'FEMALE', 'OTHERS', 'NEONATAL', 'ADULT');
DROP TYPE IF EXISTS public."StandardTestRangeType" CASCADE;
CREATE TYPE public."StandardTestRangeType" AS ENUM ('RANGE', 'DESCRIPTIVE');
DROP TYPE IF EXISTS public."StoreExportProvider" CASCADE;
CREATE TYPE public."StoreExportProvider" AS ENUM ('NO_PROVIDER', 'TWIN_HEALTH', 'GENERIC');
DROP TYPE IF EXISTS public."TaskPriority" CASCADE;
CREATE TYPE public."TaskPriority" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');
DROP TYPE IF EXISTS public."TaskRuleTriggerType" CASCADE;
CREATE TYPE public."TaskRuleTriggerType" AS ENUM ('STATUS', 'TIME');
DROP TYPE IF EXISTS public."TaskStatus" CASCADE;
CREATE TYPE public."TaskStatus" AS ENUM ('CREATED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED', 'BREACHED', 'CANCELLED', 'REASSIGNED');
DROP TYPE IF EXISTS public."TeleconsultCameraBackgroundType" CASCADE;
CREATE TYPE public."TeleconsultCameraBackgroundType" AS ENUM ('NONE', 'BLUR', 'IMAGE');
DROP TYPE IF EXISTS public."TestCategory" CASCADE;
CREATE TYPE public."TestCategory" AS ENUM ('ROUTINE', 'NON_ROUTINE');
DROP TYPE IF EXISTS public."TherapeuticClass" CASCADE;
CREATE TYPE public."TherapeuticClass" AS ENUM ('ANALGESICS', 'ANTIBACTERIALS', 'ANTIDEPRESSANTS', 'ANTIHYPERTENSIVES', 'ANTINEOPLASTICS', 'ANTIVIRALS', 'DIURETICS', 'IMMUNOSUPPRESSIVES', 'ANTI_DIABETIC', 'ANTI_INFECTIVES', 'ANTI_MALARIALS', 'ANTI_NEOPLASTICS', 'BLOOD_RELATED', 'CARDIAC', 'DERMA', 'GASTRO_INTESTINAL', 'GYNAECOLOGICAL', 'HORMONES', 'NEURO_CNS', 'OPHTHAL', 'OPHTHAL_OTOLOGICALS', 'OTHERS', 'OTOLOGICALS', 'PAIN_ANALGESICS', 'RESPIRATORY', 'SEX_STIMULANTS_REJUVENATORS', 'STOMATOLOGICALS', 'UROLOGY', 'VACCINES', 'VITAMINS_MINERALS_NUTRIENTS');
DROP TYPE IF EXISTS public."TransactionType" CASCADE;
CREATE TYPE public."TransactionType" AS ENUM ('ORDER_CHARGE', 'RECHARGE', 'SETTLEMENT', 'ADJUSTMENT', 'REFUND', 'OTHER', 'ORDER_COMMISSION');
DROP TYPE IF EXISTS public."ValidationStatus" CASCADE;
CREATE TYPE public."ValidationStatus" AS ENUM ('VALIDATED', 'UNVALIDATED', 'INVALID');
DROP TYPE IF EXISTS public."VoiceCallOutcome" CASCADE;
CREATE TYPE public."VoiceCallOutcome" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'RESCHEDULED', 'ESCALATED', 'NO_RESPONSE', 'CALL_FAILED');

-- ---- Tables ---------------------------------------------------------------
CREATE TABLE src_local."Appointment" (
    id integer,
    user_id integer,
    slot_id integer,
    speciality_id integer,
    "subSpeciality_id" integer,
    "appointmentType" public."AppointmentType",
    "appointmentStatus" public."AppointmentStatus",
    "appointmentDate" timestamp(3) without time zone,
    duration integer,
    "customerArrivalTime" timestamp(3) without time zone,
    "providerArrivalTime" timestamp(3) without time zone,
    "consultStartTime" timestamp(3) without time zone,
    "consultEndTime" timestamp(3) without time zone,
    "appointmentUrl" text,
    "cancelReason" text,
    "cancelSource" public."EntityType",
    "cancelDate" timestamp(3) without time zone,
    order_id integer,
    "createdAt" timestamp(3) without time zone,
    "updatedAt" timestamp(3) without time zone,
    "referenceId" text,
    "providerGroup_id" integer,
    "requestedSlotTime" timestamp(3) without time zone,
    "internalNotes" text,
    notes text,
    procedure_id integer,
    "providerType_id" integer,
    "isWalkIn" boolean,
    "isExternal" boolean
);

CREATE TABLE src_local."Order" (
    id integer,
    "orderType" public."OrderType",
    "appointmentTime" timestamp(3) without time zone,
    preparations text[],
    "referenceId" text,
    "labOrderReference" jsonb,
    "orderStatus" public."OrderStatus",
    "storeId" integer,
    "labId" integer,
    "labOrderId" text,
    notes text,
    "internalNotes" text,
    "userId" integer,
    "phleboName" text,
    "phleboNumber" text,
    "rawValues" jsonb,
    "assignedAt" timestamp(3) without time zone,
    "assignedBy" text,
    "createdAt" timestamp(3) without time zone,
    "updatedAt" timestamp(3) without time zone,
    "campId" integer,
    "cancelReason" text,
    "standardizedValues" jsonb,
    "statusUpdatedAt" timestamp(3) without time zone,
    "foundParameters" integer,
    "requiredParameters" integer,
    "isPostpaid" boolean,
    "sentCommunicationCancelled" boolean,
    "sentCommunicationCreated" boolean,
    "sentCommunicationOrderScheduled" boolean,
    "sentCommunicationPhleboAssigned" boolean,
    "sentCommunicationReportDelivered" boolean,
    "sentCommunicationRescheduled" boolean,
    "isLabPaymentTypeOverridable" boolean,
    "isPaymentCollectorOverridable" boolean,
    "labPayment" double precision,
    "labPaymentType" public."LabPaymentType",
    "paymentNotes" text,
    "requestId" integer,
    "storeCollection" double precision,
    "storePayment" double precision,
    "userCollection" double precision,
    "cancellationSource" public."EntityType",
    "rescheduleReason" text,
    "rescheduleSource" public."EntityType",
    "entityId" integer,
    "entityType" public."EntityType",
    "sentFeedbackOrderCompleted" boolean,
    "sentFeedbackSampleCollected" boolean,
    "isVip" boolean,
    "dispatchCourierService" text,
    "dispatchTrackingNumber" text,
    "returnCourierService" text,
    "returnTrackingNumber" text,
    "sentCommunicationKitDispatched" boolean,
    "paymentCollector" public."PaymentCollector",
    "llmExtractionLog" jsonb,
    source public."Source"
);

CREATE TABLE src_local."PharmaOrder" (
    id integer,
    "storeRefId" text,
    "pharmaRefId" text,
    "storeId" integer,
    "orderType" public."PharmaOrderType",
    "orderStatus" public."PharmaOrderStatus",
    "orderDate" timestamp(3) without time zone,
    "entityType" public."EntityType",
    "entityId" integer,
    "userId" integer,
    quantities jsonb,
    "pharmacyId" integer,
    notes text,
    "internalNotes" text,
    "gstInvoiceUrl" text,
    "shipmentTrackingId" text,
    "totalAmount" double precision,
    "cancelReason" text,
    "cancellationSource" public."EntityType",
    "createdAt" timestamp(3) without time zone,
    "updatedAt" timestamp(3) without time zone,
    "paymentStatus" public."PaymentStatus"
);

CREATE TABLE src_local."ProviderType" (
    id integer,
    "typeName" text,
    "createdAt" timestamp(3) without time zone,
    "updatedAt" timestamp(3) without time zone,
    default_procedure_id integer
);

CREATE TABLE src_local."Request" (
    id integer,
    name text,
    mobile text,
    email text,
    address text,
    "unitFloorBuilding" text,
    locality text,
    city text,
    state text,
    pincode text,
    "dateOfBirth" timestamp(3) without time zone,
    gender public."Gender",
    source public."RequestSource",
    campaign text,
    "referredBy" text,
    status public."RequestStatus",
    priority public."Priority",
    "preferredDateTime" timestamp(3) without time zone,
    notes text,
    "assignedToId" integer,
    "lastContactAt" timestamp(3) without time zone,
    "nextFollowUpAt" timestamp(3) without time zone,
    "isConverted" boolean,
    "convertedOrderId" integer,
    "convertedAt" timestamp(3) without time zone,
    "storeId" integer,
    "orderType" public."OrderType",
    "labId" integer,
    "cancellationReason" text,
    "quotedPrice" double precision,
    "createdAt" timestamp(3) without time zone,
    "updatedAt" timestamp(3) without time zone,
    "altNumber" text,
    "isServiceable" boolean,
    "isOutbound" boolean,
    "referenceId" text,
    "isVip" boolean,
    "requestGroupId" text,
    "prepaidAmount" double precision,
    "prepaidAt" timestamp(3) without time zone,
    "prepaidPaymentId" text
);

CREATE TABLE src_local."Lab" (
    id integer NOT NULL,
    "labName" text NOT NULL,
    "centerType" public."CenterType" NOT NULL,
    "logoURL" text,
    website text,
    chain_id integer,
    address text,
    locality text,
    city text,
    state text,
    pincode text,
    active boolean,
    pocs jsonb[],
    timings jsonb,
    "pincodesServiced" text[],
    "labFacilities" jsonb,
    "homeCollection" boolean,
    "slotConfigHome" jsonb,
    "slotConfigCenter" jsonb,
    "apiProvider" public."LabAPIProvider",
    "apiURL" text,
    "apiKey" text,
    "apiUsername" text,
    "apiPassword" text,
    "portalLink" text,
    "portalLoginId" text,
    "portalPassword" text,
    "vendorCode" text,
    "paymentTerms" public."PaymentTerms",
    "mouDocuments" text[],
    "mouStartDate" timestamp(3) without time zone,
    "mouEndDate" timestamp(3) without time zone,
    "gstCertificate" text,
    "gstNumber" text,
    "panNumber" text,
    "bankAccount" text,
    "bankAccountName" text,
    "bankIFSCCode" text,
    "bankUPI" text,
    "createdAt" timestamp(3) without time zone NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "labCenterEmail" text,
    latitude double precision,
    longitude double precision,
    "reportAgeRegex" text,
    "reportNameRegex" text,
    "isApiCenterVisit" boolean,
    "isApiDosUpdate" boolean,
    "isApiHomeSample" boolean,
    "isApiPpmc" boolean,
    "centerVisit" boolean,
    "internalNotes" text,
    "labCenterEmailCCs" text[],
    "labCenterMobile" text,
    "labPaymentType" public."LabPaymentTypeConfig",
    "labPdfEditService" public."LabPdfEditService",
    "contactPhleboAI" boolean,
    "bannerURL" text,
    "minimumCartValue" double precision,
    "underCartPenalty" double precision,
    "walletId" integer,
    "quotationNotificationEmail" text,
    "quotationNotificationEmailCCs" text[]
);

CREATE TABLE src_local."Package" (
    id integer NOT NULL,
    "packageName" text NOT NULL,
    "panelSubTests" text[],
    preparations text[],
    "defaultTat" integer,
    "orderTypes" public."OrderType"[],
    active boolean,
    "createdAt" timestamp(3) without time zone NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "lsId" text NOT NULL,
    "isCustom" boolean NOT NULL,
    description text
);

CREATE TABLE src_local."PackagesOnLab" (
    "labId" integer NOT NULL,
    "packageId" integer NOT NULL,
    "labCost" integer NOT NULL,
    "labPackageId" text,
    "assignedAt" timestamp(3) without time zone NOT NULL,
    "assignedBy" text NOT NULL,
    "createdAt" timestamp(3) without time zone NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "labPackageName" text,
    "labMrp" double precision,
    "sampleReportUrl" text
);

CREATE TABLE src_local."_MasterToPackage" (
    "A" integer NOT NULL,
    "B" integer NOT NULL
);

CREATE TABLE src_local."DOS" (
    id integer NOT NULL,
    "dosID" text,
    "labTestName" text NOT NULL,
    master_id integer,
    price double precision,
    "labCost" double precision,
    "dayOfWeek" jsonb,
    "turnAroundTime" integer,
    "cutOffTime" timestamp(3) without time zone,
    "nablCertified" boolean,
    active boolean,
    "inHouse" boolean,
    lab_id integer,
    "createdAt" timestamp(3) without time zone NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "conversionRatio" double precision,
    "reportRegex" text
);

CREATE TABLE src_local."Master" (
    id integer NOT NULL,
    "lsId" text NOT NULL,
    name text NOT NULL,
    "testCategory" public."TestCategory" NOT NULL,
    methodology_id integer,
    "sampleType_id" integer,
    "labDepartment_id" integer,
    hsc boolean NOT NULL,
    "isTestProfile" boolean NOT NULL,
    "subTests" text[],
    aliases text[],
    "fastingNeeded" boolean NOT NULL,
    "testDescription" text,
    "preparationNotes" text,
    "createdAt" timestamp(3) without time zone NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "subDepartment_id" integer
);

CREATE TABLE src_local."LabsOnStore" (
    "storeId" integer NOT NULL,
    "labId" integer NOT NULL,
    "storeLabRanking" integer NOT NULL,
    "assignedAt" timestamp(3) without time zone,
    "assignedBy" text,
    "createdAt" timestamp(3) without time zone,
    "updatedAt" timestamp(3) without time zone
);

CREATE TABLE src_local."PackagesOnStore" (
    "storeId" integer NOT NULL,
    "packageId" integer NOT NULL,
    "storePrice" integer NOT NULL,
    "assignedAt" timestamp(3) without time zone NOT NULL,
    "assignedBy" text NOT NULL,
    "createdAt" timestamp(3) without time zone NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "storePackageName" text,
    "storeMrp" integer
);

CREATE TABLE src_local."Store" (
    id integer,
    "storeName" text,
    "legalName" text,
    "gstNumber" text,
    "logoURL" text,
    website text,
    "storeType" text,
    address text,
    locality text,
    city text,
    state text,
    pincode text,
    "mouDocuments" text[],
    "mouStartDate" timestamp(3) without time zone,
    "mouEndDate" timestamp(3) without time zone,
    pocs jsonb[],
    active boolean,
    "apiEnabled" boolean,
    "apiCode" text,
    "apiCallbackURL" text,
    "routineDiscount" double precision,
    "nonRoutineDiscount" double precision,
    "createdAt" timestamp(3) without time zone,
    "updatedAt" timestamp(3) without time zone,
    "storeExportProvider" public."StoreExportProvider",
    "commissionRate" double precision,
    "discountRate" double precision,
    "isDoctor" boolean,
    "internalNotes" text,
    "isDefaultPostpaid" boolean,
    "sendCommunicationCancelled" boolean,
    "sendCommunicationCreated" boolean,
    "sendCommunicationOrderScheduled" boolean,
    "sendCommunicationPhleboAssigned" boolean,
    "sendCommunicationReportDelivered" boolean,
    "sendCommunicationRescheduled" boolean,
    "sendEmailCommunication" boolean,
    "sendWhatsAppCommunication" boolean,
    "sendCommunicationCancelled_new" integer,
    "sendCommunicationCreated_new" integer,
    "sendCommunicationOrderScheduled_new" integer,
    "sendCommunicationPhleboAssigned_new" integer,
    "sendCommunicationReportDelivered_new" integer,
    "sendCommunicationRescheduled_new" integer,
    "supportEmailOverride" text,
    "supportMobileOverride" text,
    "includeEmailSupportEmail" boolean,
    "includeEmailSupportMobile" boolean,
    "whatsappSupportIsMobile" boolean,
    "paymentCollector" public."PaymentCollectorConfig",
    "webhookKey" text,
    "webhookKeyHeader" text,
    "sendCommunicationOrderCompleted_new" integer,
    "sendCommunicationPhleboFeedback" boolean,
    "storeReportEmail" text,
    "storeReportEmailCCs" text[],
    "triggerConsentAiCall" boolean,
    "sendCommunicationKitDispatched_new" integer,
    "walletId" integer,
    "requestsWebhookURL" text,
    "teleconsultBackgroundUrl" text,
    "teleconsultCameraBackgroundType" public."TeleconsultCameraBackgroundType",
    "teleconsultCameraBackgroundValue" text,
    "teleconsultLogoUrl" text,
    "sendCommunicationMissedCall" boolean,
    "isUsingUniqueId" boolean,
    "isUsingProviderSlotGuardRail" boolean,
    "sendCommunicationSelfOrder" boolean
);

CREATE TABLE src_local."_MasterToRequest" (
    "A" integer NOT NULL,
    "B" integer NOT NULL
);

CREATE TABLE src_local."_PackageToRequest" (
    "A" integer NOT NULL,
    "B" integer NOT NULL
);

-- ---- The six tables a partial mirror can be missing ------------------------
-- Not in the dump above, because the machine it came from had never
-- snapshotted them. Written from what the views actually select.

CREATE TABLE IF NOT EXISTS src_local."Chain" (
    id integer,
    "chainName" text,
    name text,
    "createdAt" timestamp(3) without time zone,
    "updatedAt" timestamp(3) without time zone
);

CREATE TABLE IF NOT EXISTS src_local."ProviderType" (
    id integer,
    "typeName" text
);

CREATE TABLE IF NOT EXISTS src_local."Provider" (
    id integer,
    name text,
    "typeId" integer,
    address text,
    locality text,
    city text,
    state text,
    pincode text,
    latitude double precision,
    longitude double precision,
    mobile text,
    email text,
    -- The phlebo and nurse views read these four to judge whether a person is
    -- a real, verifiable practitioner or just a row.
    "registrationBody" text,
    "registrationNum" text,
    "isVerified" boolean,
    "experienceStart" timestamp(3) without time zone,
    active boolean,
    "createdAt" timestamp(3) without time zone,
    "updatedAt" timestamp(3) without time zone
);

CREATE TABLE IF NOT EXISTS src_local."Pharmacy" (
    id integer,
    name text,
    address text,
    city text,
    state text,
    pincode text,
    latitude double precision,
    longitude double precision,
    active boolean,
    "createdAt" timestamp(3) without time zone,
    "updatedAt" timestamp(3) without time zone
);

CREATE TABLE IF NOT EXISTS src_local."User" (
    id integer,
    email text,
    phone text,
    name text,
    "createdAt" timestamp(3) without time zone,
    "updatedAt" timestamp(3) without time zone
);

-- One row per person a user orders for — the address the order is delivered to
-- and, through it, the pincode every demand view counts.
CREATE TABLE IF NOT EXISTS src_local."Profile" (
    id integer,
    "profileUserId" integer,
    name text,
    gender public."Gender",
    dob timestamp(3) without time zone,
    address text,
    locality text,
    city text,
    state text,
    pincode text,
    -- atlas.rebuild_pincode_geo() treats a delivery address as evidence of
    -- where its pincode is, so these two are not decoration.
    latitude double precision,
    longitude double precision,
    "createdAt" timestamp(3) without time zone,
    "updatedAt" timestamp(3) without time zone
);

-- LabStack's own pincode → coordinate table. atlas.rebuild_pincode_geo() reads
-- it as one of three provenances; see sql/init/18_pincode_geo.sql.
CREATE TABLE IF NOT EXISTS src_local."PincodeToLatLong" (
    id integer,
    pincode text,
    latitude double precision,
    longitude double precision,
    city text,
    state text,
    district text
);

-- ---- Make every column optional -------------------------------------------
-- The seed sets the columns the views read. Everything else stays NULL, which
-- is only possible if nothing insists otherwise.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl, a.attname AS col
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'src_local' AND a.attnum > 0
      AND NOT a.attisdropped AND a.attnotnull
  LOOP
    EXECUTE format('ALTER TABLE src_local.%I ALTER COLUMN %I DROP NOT NULL', r.tbl, r.col);
  END LOOP;
END $$;


-- ---- Reference and join tables ---------------------------------------------
-- Small tables the catalogue, phlebo and doctor views join through. Columns
-- are the ones Atlas selects; the real tables have more.

CREATE TABLE IF NOT EXISTS src_local."SampleType" (
    id integer,
    "sampleType" text
);

CREATE TABLE IF NOT EXISTS src_local."LabDepartment" (
    id integer,
    name text
);

CREATE TABLE IF NOT EXISTS src_local."Speciality" (
    id integer,
    name text
);

CREATE TABLE IF NOT EXISTS src_local."SubSpeciality" (
    id integer,
    name text
);

CREATE TABLE IF NOT EXISTS src_local."MDMLanguage" (
    id integer,
    name text
);

CREATE TABLE IF NOT EXISTS src_local."ProviderGroup" (
    id integer,
    name text
);

CREATE TABLE IF NOT EXISTS src_local."ProviderGroupsOnStore" (
    "storeId" integer,
    "providerGroupId" integer,
    "createdAt" timestamp(3) without time zone
);

CREATE TABLE IF NOT EXISTS src_local."ProvidersOnStore" (
    "storeId" integer,
    "providerId" integer,
    "createdAt" timestamp(3) without time zone
);

-- When a provider is bookable, and for how long.
CREATE TABLE IF NOT EXISTS src_local."SlotConfig" (
    id integer,
    provider_id integer,
    "startTime" text,
    "endTime" text,
    "dayOfWeek" text,
    "isActive" boolean
);

-- Point-of-sale links: which labs a store may route to.
CREATE TABLE IF NOT EXISTS src_local."PoSOnLab" (
    "storeId" integer,
    "labId" integer,
    "createdAt" timestamp(3) without time zone
);

-- Prisma's implicit many-to-many tables. "A" and "B" are the two sides, in
-- the order Prisma sorted the model names.
CREATE TABLE IF NOT EXISTS src_local."_OrderToPackage"          ("A" integer, "B" integer);
CREATE TABLE IF NOT EXISTS src_local."_ProviderToSpeciality"    ("A" integer, "B" integer);
CREATE TABLE IF NOT EXISTS src_local."_ProviderToSubSpeciality" ("A" integer, "B" integer);
CREATE TABLE IF NOT EXISTS src_local."_ProviderToProviderGroup" ("A" integer, "B" integer);
CREATE TABLE IF NOT EXISTS src_local."_MDMLanguageToProvider"   ("A" integer, "B" integer);

-- ---- The src schema --------------------------------------------------------
-- Production reaches the LabStack replica through foreign tables in a schema
-- called src, and a dozen queries name it directly. Here it is a view over
-- the local copy, so those queries run unchanged and read the sample rows.
CREATE SCHEMA IF NOT EXISTS src;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'src_local' LOOP
    EXECUTE format('CREATE OR REPLACE VIEW src.%I AS SELECT * FROM src_local.%I',
                   r.tablename, r.tablename);
  END LOOP;
END $$;

-- ---- Indexes the views lean on --------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS src_local_lab_id      ON src_local."Lab" (id);
CREATE UNIQUE INDEX IF NOT EXISTS src_local_provider_id ON src_local."Provider" (id);
CREATE UNIQUE INDEX IF NOT EXISTS src_local_user_id     ON src_local."User" (id);
CREATE INDEX IF NOT EXISTS src_local_profile_user       ON src_local."Profile" ("profileUserId");
CREATE INDEX IF NOT EXISTS src_local_order_user         ON src_local."Order" ("userId");
CREATE INDEX IF NOT EXISTS src_local_ptl_pincode        ON src_local."PincodeToLatLong" (pincode);
