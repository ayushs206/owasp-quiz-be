import type { PrismaClient, Profile } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { ProblemError } from '../../shared/errors/problem.js';
import { lockEligibleEnrollments } from './queries.js';
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
    if (existingProfile.normalizedEmail !== normalizedEmail) {
      throw new ProblemError({
        type: 'https://quiz.example/problems/account-not-registered',
        title: 'Account not registered',
        status: 403,
        code: 'ACCOUNT_NOT_REGISTERED',
        detail: 'The verified email does not match the registered user profile email.',
      });
    }

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

  try {
    const newProfile = await db.profile.upsert({
      where: { id: userId },
      create: {
        id: userId,
        email: email.trim(),
        normalizedEmail,
        role: 'STUDENT',
        status: 'ACTIVE',
      },
      update: {},
    });

    if (newProfile.normalizedEmail !== normalizedEmail) {
      throw new ProblemError({
        type: 'https://quiz.example/problems/account-not-registered',
        title: 'Account not registered',
        status: 403,
        code: 'ACCOUNT_NOT_REGISTERED',
        detail: 'The verified email does not match the registered user profile email.',
      });
    }

    if (newProfile.status === 'BLOCKED') {
      throw new ProblemError({
        type: 'https://quiz.example/problems/account-blocked',
        title: 'Account blocked',
        status: 403,
        code: 'ACCOUNT_BLOCKED',
        detail: 'The user account has been blocked.',
      });
    }

    return mapProfileResponse(newProfile);
  } catch (error) {
    if (error instanceof ProblemError) {
      throw error;
    }
    const reFetchedProfile = await db.profile.findUnique({ where: { id: userId } });
    if (reFetchedProfile) {
      if (reFetchedProfile.normalizedEmail !== normalizedEmail) {
        throw new ProblemError({
          type: 'https://quiz.example/problems/account-not-registered',
          title: 'Account not registered',
          status: 403,
          code: 'ACCOUNT_NOT_REGISTERED',
          detail: 'The verified email does not match the registered user profile email.',
        });
      }
      if (reFetchedProfile.status === 'BLOCKED') {
        throw new ProblemError({
          type: 'https://quiz.example/problems/account-blocked',
          title: 'Account blocked',
          status: 403,
          code: 'ACCOUNT_BLOCKED',
          detail: 'The user account has been blocked.',
        });
      }
      return mapProfileResponse(reFetchedProfile);
    }
    throw error;
  }
}

export async function completeOnboarding(
  userId: string,
  email: string,
  input: OnboardingInput,
  db: PrismaClient = prisma,
): Promise<{ profile: ProfileResponse; created: boolean }> {
  const normalizedEmail = email.trim().toLowerCase();

  try {
    return await db.$transaction(async (tx) => {
      const existingProfileByEmail = await tx.profile.findUnique({
        where: { normalizedEmail },
      });
      if (existingProfileByEmail && existingProfileByEmail.id !== userId) {
        throw new ProblemError({
          type: 'https://quiz.example/problems/account-not-registered',
          title: 'Account not registered',
          status: 403,
          code: 'ACCOUNT_NOT_REGISTERED',
          detail: 'The user is not registered in any eligible quiz roster.',
        });
      }

      const profile = await tx.profile.findUnique({ where: { id: userId } });

      if (profile) {
        if (profile.normalizedEmail !== normalizedEmail) {
          throw new ProblemError({
            type: 'https://quiz.example/problems/account-not-registered',
            title: 'Account not registered',
            status: 403,
            code: 'ACCOUNT_NOT_REGISTERED',
            detail: 'The verified email does not match the registered user profile email.',
          });
        }

        if (profile.status === 'BLOCKED') {
          throw new ProblemError({
            type: 'https://quiz.example/problems/account-blocked',
            title: 'Account blocked',
            status: 403,
            code: 'ACCOUNT_BLOCKED',
            detail: 'The user account has been blocked.',
          });
        }

        if (profile.profileCompletedAt !== null) {
          const isMatching =
            profile.fullName === input.fullName &&
            profile.rollNumber?.toLowerCase() === input.rollNumber.toLowerCase() &&
            profile.branchCode?.toLowerCase() === input.branchCode.toLowerCase() &&
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
      }

      const eligibleEnrollments = await lockEligibleEnrollments(tx, normalizedEmail);

      if (eligibleEnrollments.length === 0) {
        throw new ProblemError({
          type: 'https://quiz.example/problems/account-not-registered',
          title: 'Account not registered',
          status: 403,
          code: 'ACCOUNT_NOT_REGISTERED',
          detail: 'The user is not registered in any eligible quiz roster.',
        });
      }

      // The roster lock serializes onboarding for this verified email. Re-read
      // identity state after acquiring it so a waiting request cannot overwrite
      // a profile completed by the transaction that held the lock first.
      const lockedProfileByEmail = await tx.profile.findUnique({
        where: { normalizedEmail },
      });
      if (lockedProfileByEmail && lockedProfileByEmail.id !== userId) {
        throw new ProblemError({
          type: 'https://quiz.example/problems/account-not-registered',
          title: 'Account not registered',
          status: 403,
          code: 'ACCOUNT_NOT_REGISTERED',
          detail: 'The user is not registered in any eligible quiz roster.',
        });
      }

      const lockedProfile = await tx.profile.findUnique({ where: { id: userId } });
      if (lockedProfile) {
        if (lockedProfile.normalizedEmail !== normalizedEmail) {
          throw new ProblemError({
            type: 'https://quiz.example/problems/account-not-registered',
            title: 'Account not registered',
            status: 403,
            code: 'ACCOUNT_NOT_REGISTERED',
            detail: 'The verified email does not match the registered user profile email.',
          });
        }

        if (lockedProfile.status === 'BLOCKED') {
          throw new ProblemError({
            type: 'https://quiz.example/problems/account-blocked',
            title: 'Account blocked',
            status: 403,
            code: 'ACCOUNT_BLOCKED',
            detail: 'The user account has been blocked.',
          });
        }

        if (lockedProfile.profileCompletedAt !== null) {
          const isMatching =
            lockedProfile.fullName === input.fullName &&
            lockedProfile.rollNumber?.toLowerCase() === input.rollNumber.toLowerCase() &&
            lockedProfile.branchCode?.toLowerCase() === input.branchCode.toLowerCase() &&
            lockedProfile.phoneE164 === input.phoneNumber;

          if (isMatching) {
            return { profile: mapProfileResponse(lockedProfile), created: false };
          }

          throw new ProblemError({
            type: 'https://quiz.example/problems/profile-already-completed',
            title: 'Profile already completed',
            status: 409,
            code: 'CONFLICT',
            detail: 'The profile has already been completed and cannot be modified via onboarding.',
          });
        }
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

      const rollNumber = matchingRoster.rollNumber;
      const branchCode = matchingRoster.branchCode;

      for (const e of eligibleEnrollments) {
        if (
          e.rollNumber.trim().toLowerCase() !== rollNumber.toLowerCase() ||
          e.branchCode.trim().toLowerCase() !== branchCode.toLowerCase()
        ) {
          throw new ProblemError({
            type: 'https://quiz.example/problems/roster-details-mismatch',
            title: 'Roster details mismatch',
            status: 409,
            code: 'ROSTER_DETAILS_MISMATCH',
            detail: 'Conflicting roster details found across eligible enrollments.',
          });
        }
        if (e.userId !== null && e.userId !== userId) {
          throw new ProblemError({
            type: 'https://quiz.example/problems/roster-details-mismatch',
            title: 'Roster details mismatch',
            status: 409,
            code: 'ROSTER_DETAILS_MISMATCH',
            detail: 'Roster record is already linked to another user account.',
          });
        }
      }

      const duplicateRollProfile = await tx.profile.findFirst({
        where: {
          rollNumber,
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
          rollNumber,
          branchCode,
          phoneE164: input.phoneNumber,
          role: 'STUDENT',
          status: 'ACTIVE',
          profileCompletedAt: now,
        },
        update: {
          fullName: input.fullName,
          rollNumber,
          branchCode,
          phoneE164: input.phoneNumber,
          profileCompletedAt: now,
        },
      });

      if (updatedProfile.normalizedEmail !== normalizedEmail) {
        throw new ProblemError({
          type: 'https://quiz.example/problems/account-not-registered',
          title: 'Account not registered',
          status: 403,
          code: 'ACCOUNT_NOT_REGISTERED',
          detail: 'The verified email does not match the registered user profile email.',
        });
      }

      const linkedEnrollments = await tx.quizEnrollment.updateMany({
        where: {
          normalizedEmail,
          status: 'ELIGIBLE',
          OR: [{ userId: null }, { userId }],
        },
        data: {
          userId,
        },
      });

      if (linkedEnrollments.count !== eligibleEnrollments.length) {
        throw new ProblemError({
          type: 'https://quiz.example/problems/roster-details-mismatch',
          title: 'Roster details mismatch',
          status: 409,
          code: 'ROSTER_DETAILS_MISMATCH',
          detail: 'One or more roster records could not be linked safely.',
        });
      }

      return {
        profile: mapProfileResponse(updatedProfile),
        created: true,
      };
    });
  } catch (error) {
    if (error instanceof ProblemError) {
      throw error;
    }
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      const target = (error as { meta?: { target?: string[] | string } }).meta?.target;
      const targetStr = Array.isArray(target) ? target.join(',') : (target ?? '');
      if (targetStr.includes('roll_number') || targetStr.includes('rollNumber')) {
        throw new ProblemError({
          type: 'https://quiz.example/problems/roll-number-already-registered',
          title: 'Roll number already registered',
          status: 409,
          code: 'ROLL_NUMBER_ALREADY_REGISTERED',
          detail: 'The roll number is already registered to another user profile.',
        });
      }
      if (targetStr.includes('normalized_email') || targetStr.includes('normalizedEmail')) {
        throw new ProblemError({
          type: 'https://quiz.example/problems/account-not-registered',
          title: 'Account not registered',
          status: 403,
          code: 'ACCOUNT_NOT_REGISTERED',
          detail: 'The email address is already associated with another profile.',
        });
      }
      throw new ProblemError({
        type: 'https://quiz.example/problems/profile-already-completed',
        title: 'Profile conflict',
        status: 409,
        code: 'CONFLICT',
        detail: 'Profile data conflicts with an existing record.',
      });
    }
    throw error;
  }
}

export interface AdminListUsersResponse {
  data: ProfileResponse[];
  nextCursor: string | null;
}

export async function adminListUsers(
  query: { cursor?: string | undefined; limit: number },
  db: PrismaClient = prisma,
): Promise<AdminListUsersResponse> {
  const take = query.limit + 1;
  const profiles = await db.profile.findMany({
    take,
    ...(query.cursor
      ? {
          cursor: { id: query.cursor },
          skip: 1,
        }
      : {}),
    orderBy: { id: 'asc' },
  });

  let nextCursor: string | null = null;
  if (profiles.length > query.limit) {
    profiles.pop();
    nextCursor = profiles.at(-1)?.id ?? null;
  }

  return {
    data: profiles.map(mapProfileResponse),
    nextCursor,
  };
}

export async function adminGetUser(
  userId: string,
  db: PrismaClient = prisma,
): Promise<ProfileResponse> {
  const profile = await db.profile.findUnique({ where: { id: userId } });
  if (!profile) {
    throw new ProblemError({
      type: 'https://quiz.example/problems/user-not-found',
      title: 'User not found',
      status: 404,
      code: 'NOT_FOUND',
      detail: 'The requested user profile was not found.',
    });
  }
  return mapProfileResponse(profile);
}

export interface AuditLogger {
  info(object: Record<string, unknown>, msg?: string): void;
}

export async function adminUpdateUser(
  actorId: string,
  targetUserId: string,
  input: {
    fullName?: string;
    rollNumber?: string;
    branchCode?: string;
    phoneNumber?: string;
    role?: 'STUDENT' | 'ADMIN';
    status?: 'ACTIVE' | 'BLOCKED';
  },
  requestId: string | undefined,
  logger: AuditLogger | undefined,
  db: PrismaClient = prisma,
): Promise<ProfileResponse> {
  const existing = await db.profile.findUnique({ where: { id: targetUserId } });
  if (!existing) {
    throw new ProblemError({
      type: 'https://quiz.example/problems/user-not-found',
      title: 'User not found',
      status: 404,
      code: 'NOT_FOUND',
      detail: 'The requested user profile was not found.',
    });
  }

  if (input.rollNumber && input.rollNumber !== existing.rollNumber) {
    const duplicate = await db.profile.findFirst({
      where: {
        rollNumber: input.rollNumber,
        id: { not: targetUserId },
        profileCompletedAt: { not: null },
      },
    });
    if (duplicate) {
      throw new ProblemError({
        type: 'https://quiz.example/problems/roll-number-already-registered',
        title: 'Roll number already registered',
        status: 409,
        code: 'ROLL_NUMBER_ALREADY_REGISTERED',
        detail: 'The roll number is already registered to another user profile.',
      });
    }
  }

  const dataToUpdate: {
    fullName?: string;
    rollNumber?: string;
    branchCode?: string;
    phoneE164?: string;
    role?: 'STUDENT' | 'ADMIN';
    status?: 'ACTIVE' | 'BLOCKED';
  } = {};

  if (input.fullName !== undefined) dataToUpdate.fullName = input.fullName;
  if (input.rollNumber !== undefined) dataToUpdate.rollNumber = input.rollNumber;
  if (input.branchCode !== undefined) dataToUpdate.branchCode = input.branchCode;
  if (input.phoneNumber !== undefined) dataToUpdate.phoneE164 = input.phoneNumber;
  if (input.role !== undefined) dataToUpdate.role = input.role;
  if (input.status !== undefined) dataToUpdate.status = input.status;

  try {
    const updated = await db.profile.update({
      where: { id: targetUserId },
      data: dataToUpdate,
    });

    if (logger) {
      logger.info(
        {
          actionType: 'ADMIN_UPDATE_USER',
          actorId,
          targetId: targetUserId,
          requestId: requestId ?? null,
          updatedFields: Object.keys(input),
        },
        'Privileged action: User profile updated by admin',
      );
    }

    return mapProfileResponse(updated);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      const target = (error as { meta?: { target?: string[] | string } }).meta?.target;
      const targetStr = Array.isArray(target) ? target.join(',') : (target ?? '');
      if (targetStr.includes('roll_number') || targetStr.includes('rollNumber')) {
        throw new ProblemError({
          type: 'https://quiz.example/problems/roll-number-already-registered',
          title: 'Roll number already registered',
          status: 409,
          code: 'ROLL_NUMBER_ALREADY_REGISTERED',
          detail: 'The roll number is already registered to another user profile.',
        });
      }
    }
    throw error;
  }
}
