/**
 * lib/config/fields.ts
 *
 * Backward-compatibility shim.
 * All canonical field definitions now live in lib/db/metadata.ts.
 * This file re-exports them so existing imports continue to work.
 */

export { FIELD_META as BUSINESS_FIELDS, WRITABLE_FIELDS as SORTED_FIELD_NAMES, BUSINESSES_SCHEMA_SQL } from "@/lib/db/metadata";
export type { FieldMeta as FieldConfig } from "@/lib/db/metadata";
