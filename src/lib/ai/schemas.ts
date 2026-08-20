import { z } from "zod";

const nullableNumber = z.number().finite().nonnegative().nullable();
const nullableString = z.string().nullable();

export const lineItemSchema = z.object({
  id: z.string().min(1),
  rawDescription: z.string(),
  normalizedDescription: z.string().min(1),
  quantity: nullableNumber,
  partCost: nullableNumber,
  labourCost: nullableNumber,
  paintCost: nullableNumber,
  totalCost: nullableNumber,
  category: z.enum(["part", "labour", "paint", "other"]),
  material: z.enum([
    "metal",
    "plastic",
    "glass",
    "fiberglass",
    "rubber",
    "electrical",
    "mechanical",
    "paint",
    "unknown",
  ]),
  action: z.enum(["repair", "replace", "paint", "inspect", "unknown"]),
  vehicleLocation: nullableString,
  sourceBlockIds: z.array(z.string()),
  confidence: z.enum(["high", "medium", "low"]),
}).strict();

export const claimUnderstandingSchema = z.object({
  estimate: z.object({
    estimateNumber: nullableString,
    partsTotal: z.number().finite().nonnegative(),
    labourTotal: z.number().finite().nonnegative(),
    paintTotal: z.number().finite().nonnegative(),
    grandTotal: z.number().finite().nonnegative(),
  }).strict(),
  lineItems: z.array(lineItemSchema).min(1),
  missingInformation: z.array(z.object({
    field: z.string().min(1),
    description: z.string().min(1),
    required: z.boolean(),
  }).strict()),
  semanticReview: z.array(z.object({
    itemId: z.string().min(1),
    normalizedDescription: z.string(),
    classification: z.enum([
      "CONSISTENT",
      "POSSIBLY_CONSISTENT",
      "REQUIRES_VERIFICATION",
      "INCONSISTENT_WITH_DESCRIPTION",
    ]),
    reason: z.string().min(1),
  }).strict()),
}).strict();

export const groundedRagSchema = z.object({
  answer: z.string().min(1),
  usedChunkIds: z.array(z.string()),
}).strict();

export type ClaimUnderstandingOutput = z.infer<typeof claimUnderstandingSchema>;
export type GroundedRagOutput = z.infer<typeof groundedRagSchema>;

export const claimUnderstandingJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["estimate", "lineItems", "missingInformation", "semanticReview"],
  properties: {
    estimate: {
      type: "object",
      additionalProperties: false,
      required: ["estimateNumber", "partsTotal", "labourTotal", "paintTotal", "grandTotal"],
      properties: {
        estimateNumber: { type: ["string", "null"] },
        partsTotal: { type: "number", minimum: 0 },
        labourTotal: { type: "number", minimum: 0 },
        paintTotal: { type: "number", minimum: 0 },
        grandTotal: { type: "number", minimum: 0 },
      },
    },
    lineItems: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id", "rawDescription", "normalizedDescription", "quantity", "partCost",
          "labourCost", "paintCost", "totalCost", "category", "material", "action",
          "vehicleLocation", "sourceBlockIds", "confidence",
        ],
        properties: {
          id: { type: "string" },
          rawDescription: { type: "string" },
          normalizedDescription: { type: "string" },
          quantity: { type: ["number", "null"], minimum: 0 },
          partCost: { type: ["number", "null"], minimum: 0 },
          labourCost: { type: ["number", "null"], minimum: 0 },
          paintCost: { type: ["number", "null"], minimum: 0 },
          totalCost: { type: ["number", "null"], minimum: 0 },
          category: { enum: ["part", "labour", "paint", "other"] },
          material: { enum: ["metal", "plastic", "glass", "fiberglass", "rubber", "electrical", "mechanical", "paint", "unknown"] },
          action: { enum: ["repair", "replace", "paint", "inspect", "unknown"] },
          vehicleLocation: { type: ["string", "null"] },
          sourceBlockIds: { type: "array", items: { type: "string" } },
          confidence: { enum: ["high", "medium", "low"] },
        },
      },
    },
    missingInformation: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "description", "required"],
        properties: {
          field: { type: "string" },
          description: { type: "string" },
          required: { type: "boolean" },
        },
      },
    },
    semanticReview: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["itemId", "normalizedDescription", "classification", "reason"],
        properties: {
          itemId: { type: "string" },
          normalizedDescription: { type: "string" },
          classification: {
            enum: ["CONSISTENT", "POSSIBLY_CONSISTENT", "REQUIRES_VERIFICATION", "INCONSISTENT_WITH_DESCRIPTION"],
          },
          reason: { type: "string" },
        },
      },
    },
  },
} as const;

export const groundedRagJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "usedChunkIds"],
  properties: {
    answer: { type: "string" },
    usedChunkIds: { type: "array", items: { type: "string" } },
  },
} as const;
