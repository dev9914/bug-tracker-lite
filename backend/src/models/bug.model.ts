import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const BUG_SEVERITIES = ['low', 'med', 'high'] as const;
export const BUG_STATUSES = ['open', 'in-progress', 'closed'] as const;

const bugSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    severity: { type: String, enum: BUG_SEVERITIES, required: true },
    status: { type: String, enum: BUG_STATUSES, default: 'open' },
    imageKey: { type: String },
  },
  { timestamps: true },
);

// The owner prefix also serves the plain "bugs by user" lookup.
bugSchema.index({ userId: 1, createdAt: -1 });
bugSchema.index({ userId: 1, status: 1 });

export type Bug = InferSchemaType<typeof bugSchema>;
export type BugDocument = HydratedDocument<Bug>;

export const BugModel = model('Bug', bugSchema);
