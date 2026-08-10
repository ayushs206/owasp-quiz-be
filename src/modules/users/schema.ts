import { z } from 'zod';

export const onboardingRequestSchema = z
  .object({
    fullName: z.string().trim().min(1).max(120),
    rollNumber: z.string().trim().min(1).max(40),
    branchCode: z.string().trim().min(1).max(40),
    phoneNumber: z
      .string()
      .trim()
      .regex(/^\+[1-9][0-9]{7,14}$/, 'Phone number must be in valid E.164 format'),
  })
  .strict();

export type OnboardingInput = z.infer<typeof onboardingRequestSchema>;

export const adminListUsersQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type AdminListUsersQuery = z.infer<typeof adminListUsersQuerySchema>;

export const userIdParamSchema = z.object({
  userId: z.string().uuid(),
});

export const adminUserUpdateRequestSchema = z
  .object({
    fullName: z.string().trim().min(1).max(120).optional(),
    rollNumber: z.string().trim().min(1).max(40).optional(),
    branchCode: z.string().trim().min(1).max(40).optional(),
    phoneNumber: z
      .string()
      .trim()
      .regex(/^\+[1-9][0-9]{7,14}$/, 'Phone number must be in valid E.164 format')
      .optional(),
    role: z.enum(['STUDENT', 'ADMIN']).optional(),
    status: z.enum(['ACTIVE', 'BLOCKED']).optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

export type AdminUserUpdateInput = z.infer<typeof adminUserUpdateRequestSchema>;
