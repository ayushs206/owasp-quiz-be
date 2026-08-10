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
