import type { PrismaClient, Profile } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { ProblemError } from '../../shared/errors/problem.js';
import type { OnboardingInput } from './schema.js';

export interface ProfileResponse {
  id: string;
  email: string;
  fullName: string | null;
  rollNumber: string | null;
  branchCode: string | null;
  phoneNumber: string | null;
  role: 'STUDENT' | 'ADMIN';
  status: 'ACTIVE' | 'BLOCKED';
  onboardingStatus: 'REQUIRED' | 'COMPLETED';
  profileCompletedAt: string | null;
}

export function mapProfileResponse(profile: Profile): ProfileResponse {
  const isCompleted = profile.profileCompletedAt !== null;
  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.fullName ?? null,
    rollNumber: profile.rollNumber ?? null,
    branchCode: profile.branchCode ?? null,
    phoneNumber: profile.phoneE164 ?? null,
    role: profile.role,
    status: profile.status,
    onboardingStatus: isCompleted ? 'COMPLETED' : 'REQUIRED',
    profileCompletedAt: profile.profileCompletedAt
      ? profile.profileCompletedAt.toISOString()
      : null,
  };
}

export async function getCurrentProfile(
  userId: string,
  email: string,
  db: PrismaClient = prisma,
): Promise<ProfileResponse> {
  const normalizedEmail = email.trim().toLowerCase();
  const existingProfile = await db.profile.findUnique({ where: { id: userId } });

  if (existingProfile) {
    if (existingProfile.status === 'BLOCKED') {
      throw new ProblemError({
        type: 'https://quiz.example/problems/account-blocked',
        title: 'Account blocked',
        status: 403,
        code: 'ACCOUNT_BLOCKED',
        detail: 'The user account has been blocked.',
      });
    }

    if (existingProfile.profileCompletedAt !== null) {
      return mapProfileResponse(existingProfile);
    }

    const eligibleEnrollment = await db.quizEnrollment.findFirst({
      where: { normalizedEmail, status: 'ELIGIBLE' },
    });

    if (!eligibleEnrollment) {
      throw new ProblemError({
        type: 'https://quiz.example/problems/account-not-registered',
        title: 'Account not registered',
        status: 403,
        code: 'ACCOUNT_NOT_REGISTERED',
        detail: 'The user is not registered in any eligible quiz roster.',
      });
    }

    return mapProfileResponse(existingProfile);
  }

  const existingEmailProfile = await db.profile.findUnique({ where: { normalizedEmail } });
  if (existingEmailProfile && existingEmailProfile.id !== userId) {
    throw new ProblemError({
      type: 'https://quiz.example/problems/account-not-registered',
      title: 'Account not registered',
      status: 403,
      code: 'ACCOUNT_NOT_REGISTERED',
      detail: 'The user is not registered in any eligible quiz roster.',
    });
  }

  const eligibleEnrollment = await db.quizEnrollment.findFirst({
    where: { normalizedEmail, status: 'ELIGIBLE' },
  });

  if (!eligibleEnrollment) {
    throw new ProblemError({
      type: 'https://quiz.example/problems/account-not-registered',
      title: 'Account not registered',
      status: 403,
      code: 'ACCOUNT_NOT_REGISTERED',
      detail: 'The user is not registered in any eligible quiz roster.',
    });
  }

  const newProfile = await db.profile.create({
    data: {
      id: userId,
      email: email.trim(),
      normalizedEmail,
      role: 'STUDENT',
      status: 'ACTIVE',
    },
  });

  return mapProfileResponse(newProfile);
}

export async function completeOnboarding(
  userId: string,
  email: string,
  input: OnboardingInput,
  db: PrismaClient = prisma,
): Promise<{ profile: ProfileResponse; created: boolean }> {
  const normalizedEmail = email.trim().toLowerCase();

  return await db.$transaction(async (tx) => {
    const profile = await tx.profile.findUnique({ where: { id: userId } });

    if (profile && profile.status === 'BLOCKED') {
      throw new ProblemError({
        type: 'https://quiz.example/problems/account-blocked',
        title: 'Account blocked',
        status: 403,
        code: 'ACCOUNT_BLOCKED',
        detail: 'The user account has been blocked.',
      });
    }

    if (profile && profile.profileCompletedAt !== null) {
      const isMatching =
        profile.fullName === input.fullName &&
        profile.rollNumber === input.rollNumber &&
        profile.branchCode === input.branchCode &&
        profile.phoneE164 === input.phoneNumber;

      if (isMatching) {
        return { profile: mapProfileResponse(profile), created: false };
      }

      throw new ProblemError({
        type: 'https://quiz.example/problems/profile-already-completed',
        title: 'Profile already completed',
        status: 409,
        code: 'CONFLICT',
        detail: 'The profile has already been completed and cannot be modified via onboarding.',
      });
    }

    const eligibleEnrollments = await tx.quizEnrollment.findMany({
      where: {
        normalizedEmail,
        status: 'ELIGIBLE',
      },
    });

    if (eligibleEnrollments.length === 0) {
      throw new ProblemError({
        type: 'https://quiz.example/problems/account-not-registered',
        title: 'Account not registered',
        status: 403,
        code: 'ACCOUNT_NOT_REGISTERED',
        detail: 'The user is not registered in any eligible quiz roster.',
      });
    }

    const matchingRoster = eligibleEnrollments.find(
      (e) =>
        e.rollNumber.trim().toLowerCase() === input.rollNumber.toLowerCase() &&
        e.branchCode.trim().toLowerCase() === input.branchCode.toLowerCase(),
    );

    if (!matchingRoster) {
      throw new ProblemError({
        type: 'https://quiz.example/problems/roster-details-mismatch',
        title: 'Roster details mismatch',
        status: 409,
        code: 'ROSTER_DETAILS_MISMATCH',
        detail:
          'The provided roll number or branch code does not match the eligible roster record.',
      });
    }

    const duplicateRollProfile = await tx.profile.findFirst({
      where: {
        rollNumber: input.rollNumber,
        id: { not: userId },
        profileCompletedAt: { not: null },
      },
    });

    if (duplicateRollProfile) {
      throw new ProblemError({
        type: 'https://quiz.example/problems/roll-number-already-registered',
        title: 'Roll number already registered',
        status: 409,
        code: 'ROLL_NUMBER_ALREADY_REGISTERED',
        detail: 'The roll number is already registered to another user profile.',
      });
    }

    const now = new Date();
    const updatedProfile = await tx.profile.upsert({
      where: { id: userId },
      create: {
        id: userId,
        email: email.trim(),
        normalizedEmail,
        fullName: input.fullName,
        rollNumber: input.rollNumber,
        branchCode: input.branchCode,
        phoneE164: input.phoneNumber,
        role: 'STUDENT',
        status: 'ACTIVE',
        profileCompletedAt: now,
      },
      update: {
        fullName: input.fullName,
        rollNumber: input.rollNumber,
        branchCode: input.branchCode,
        phoneE164: input.phoneNumber,
        profileCompletedAt: now,
      },
    });

    await tx.quizEnrollment.updateMany({
      where: {
        normalizedEmail,
        status: 'ELIGIBLE',
      },
      data: {
        userId,
      },
    });

    return {
      profile: mapProfileResponse(updatedProfile),
      created: true,
    };
  });
}
