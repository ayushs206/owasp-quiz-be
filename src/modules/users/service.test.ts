import type { Express } from 'express';
import type { EnrollmentStatus, PrismaClient, Profile, QuizEnrollment } from '@prisma/client';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import pino from 'pino';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { createApp, type AppDependencies } from '../../app.js';
import type { JwksFetcher } from '../../lib/supabase.js';
import type { Env } from '../../shared/config/env.js';
import type { ProblemBody } from '../../shared/errors/problem.js';
import { completeOnboarding, getCurrentProfile, type AdminListUsersResponse } from './service.js';

type TestPrivateKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

const mockEnv: Env = {
  NODE_ENV: 'test',
  PORT: 3001,
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/test',
  DIRECT_URL: 'postgresql://postgres:postgres@localhost:5432/test',
  SUPABASE_URL: 'https://test-project.supabase.co',
  SUPABASE_JWKS_URL: 'https://test-project.supabase.co/auth/v1/.well-known/jwks.json',
  SUPABASE_JWT_ISSUER: 'https://test-project.supabase.co/auth/v1',
  SUPABASE_JWT_AUDIENCE: 'authenticated',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  SUPABASE_STORAGE_BUCKET: 'quiz-media',
  ALLOWED_EMAIL_DOMAINS: ['thapar.edu'],
  CORS_ORIGINS: ['http://localhost:3000'],
};

function createMockDb(
  initialData: {
    profiles?: Profile[];
    enrollments?: QuizEnrollment[];
  } = {},
): PrismaClient {
  const profiles = [...(initialData.profiles ?? [])];
  const enrollments = [...(initialData.enrollments ?? [])];

  const db: unknown = {
    profile: {
      findUnique({
        where,
      }: {
        where: { id?: string; normalizedEmail?: string };
      }): Promise<Profile | null> {
        if (where.id) {
          return Promise.resolve(profiles.find((p) => p.id === where.id) ?? null);
        }
        if (where.normalizedEmail) {
          return Promise.resolve(
            profiles.find((p) => p.normalizedEmail === where.normalizedEmail) ?? null,
          );
        }
        return Promise.resolve(null);
      },
      findFirst({
        where,
      }: {
        where: { rollNumber?: string; id?: { not?: string }; profileCompletedAt?: { not?: null } };
      }): Promise<Profile | null> {
        return Promise.resolve(
          profiles.find((p) => {
            if (where.rollNumber && p.rollNumber !== where.rollNumber) return false;
            if (where.id?.not && p.id === where.id.not) return false;
            if (where.profileCompletedAt?.not === null && p.profileCompletedAt === null)
              return false;
            return true;
          }) ?? null,
        );
      },
      create({ data }: { data: Partial<Profile> }): Promise<Profile> {
        const now = new Date();
        const newProfile: Profile = {
          id: data.id ?? 'uuid',
          email: data.email ?? '',
          normalizedEmail: data.normalizedEmail ?? '',
          fullName: data.fullName ?? null,
          rollNumber: data.rollNumber ?? null,
          branchCode: data.branchCode ?? null,
          phoneE164: data.phoneE164 ?? null,
          role: data.role ?? 'STUDENT',
          status: data.status ?? 'ACTIVE',
          profileCompletedAt: data.profileCompletedAt ?? null,
          createdAt: now,
          updatedAt: now,
        };
        profiles.push(newProfile);
        return Promise.resolve(newProfile);
      },
      upsert({
        where,
        create,
        update,
      }: {
        where: { id: string };
        create: Partial<Profile>;
        update: Partial<Profile>;
      }): Promise<Profile> {
        const index = profiles.findIndex((p) => p.id === where.id);
        const now = new Date();
        if (index >= 0) {
          const target = profiles[index];
          if (target) {
            const updated: Profile = {
              id: target.id,
              email: target.email,
              normalizedEmail: target.normalizedEmail,
              fullName: update.fullName !== undefined ? update.fullName : target.fullName,
              rollNumber: update.rollNumber !== undefined ? update.rollNumber : target.rollNumber,
              branchCode: update.branchCode !== undefined ? update.branchCode : target.branchCode,
              phoneE164: update.phoneE164 !== undefined ? update.phoneE164 : target.phoneE164,
              role: update.role !== undefined ? update.role : target.role,
              status: update.status !== undefined ? update.status : target.status,
              profileCompletedAt:
                update.profileCompletedAt !== undefined
                  ? update.profileCompletedAt
                  : target.profileCompletedAt,
              createdAt: target.createdAt,
              updatedAt: now,
            };
            profiles[index] = updated;
            return Promise.resolve(updated);
          }
        }
        const newProfile: Profile = {
          id: create.id ?? where.id,
          email: create.email ?? '',
          normalizedEmail: create.normalizedEmail ?? '',
          fullName: create.fullName ?? null,
          rollNumber: create.rollNumber ?? null,
          branchCode: create.branchCode ?? null,
          phoneE164: create.phoneE164 ?? null,
          role: create.role ?? 'STUDENT',
          status: create.status ?? 'ACTIVE',
          profileCompletedAt: create.profileCompletedAt ?? null,
          createdAt: now,
          updatedAt: now,
        };
        profiles.push(newProfile);
        return Promise.resolve(newProfile);
      },
      findMany({
        take,
        cursor,
        skip,
      }: {
        take?: number;
        cursor?: { id: string };
        skip?: number;
      } = {}): Promise<Profile[]> {
        let result = [...profiles].sort((a, b) => a.id.localeCompare(b.id));
        if (cursor) {
          const idx = result.findIndex((p) => p.id === cursor.id);
          if (idx >= 0) {
            result = result.slice(idx + (skip ?? 0));
          }
        }
        if (take !== undefined) {
          result = result.slice(0, take);
        }
        return Promise.resolve(result);
      },
      update({ where, data }: { where: { id: string }; data: Partial<Profile> }): Promise<Profile> {
        const index = profiles.findIndex((p) => p.id === where.id);
        if (index < 0 || !profiles[index]) {
          return Promise.reject(new Error('Record to update not found.'));
        }
        const target = profiles[index];
        const updated: Profile = {
          ...target,
          fullName: data.fullName !== undefined ? data.fullName : target.fullName,
          rollNumber: data.rollNumber !== undefined ? data.rollNumber : target.rollNumber,
          branchCode: data.branchCode !== undefined ? data.branchCode : target.branchCode,
          phoneE164: data.phoneE164 !== undefined ? data.phoneE164 : target.phoneE164,
          role: data.role !== undefined ? data.role : target.role,
          status: data.status !== undefined ? data.status : target.status,
          updatedAt: new Date(),
        };
        profiles[index] = updated;
        return Promise.resolve(updated);
      },
    },
    quizEnrollment: {
      findFirst({
        where,
      }: {
        where: { normalizedEmail: string; status: EnrollmentStatus };
      }): Promise<QuizEnrollment | null> {
        return Promise.resolve(
          enrollments.find(
            (e) => e.normalizedEmail === where.normalizedEmail && e.status === where.status,
          ) ?? null,
        );
      },
      findMany({
        where,
      }: {
        where: { normalizedEmail: string; status: EnrollmentStatus };
      }): Promise<QuizEnrollment[]> {
        return Promise.resolve(
          enrollments.filter(
            (e) => e.normalizedEmail === where.normalizedEmail && e.status === where.status,
          ),
        );
      },
      updateMany({
        where,
        data,
      }: {
        where: {
          normalizedEmail: string;
          status: EnrollmentStatus;
          OR?: Array<{ userId: null } | { userId: string }>;
        };
        data: { userId: string };
      }): Promise<{ count: number }> {
        let count = 0;
        for (const e of enrollments) {
          if (e.normalizedEmail !== where.normalizedEmail || e.status !== where.status) continue;
          if (where.OR) {
            const allowed = where.OR.some(
              (cond) =>
                ('userId' in cond && cond.userId === null && e.userId === null) ||
                ('userId' in cond && cond.userId !== null && e.userId === cond.userId),
            );
            if (!allowed) continue;
          }
          e.userId = data.userId;
          count++;
        }
        return Promise.resolve({ count });
      },
    },
    async $transaction<T>(callback: (tx: PrismaClient) => Promise<T>): Promise<T> {
      return await callback(db as PrismaClient);
    },
    $queryRaw(_query: TemplateStringsArray, normalizedEmail: string): Promise<QuizEnrollment[]> {
      return Promise.resolve(
        enrollments.filter((e) => e.normalizedEmail === normalizedEmail && e.status === 'ELIGIBLE'),
      );
    },
  };

  return db as PrismaClient;
}

describe('Users Module: Service and Routes', () => {
  let privateKey: TestPrivateKey;
  let jwksFetcher: JwksFetcher;

  beforeAll(async () => {
    const keyPair = await generateKeyPair('RS256');
    privateKey = keyPair.privateKey;
    const publicJwk = await exportJWK(keyPair.publicKey);
    publicJwk.kid = 'test-key-id';
    publicJwk.alg = 'RS256';
    jwksFetcher = createLocalJWKSet({ keys: [publicJwk] });
  });

  async function createToken(claims: Record<string, unknown> = {}): Promise<string> {
    return new SignJWT({
      sub: '550e8400-e29b-41d4-a716-446655440000',
      email: 'student@thapar.edu',
      email_verified: true,
      app_metadata: { provider: 'google' },
      amr: [{ method: 'oauth', timestamp: 1_723_000_000 }],
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-id' })
      .setIssuedAt()
      .setIssuer(mockEnv.SUPABASE_JWT_ISSUER)
      .setAudience(mockEnv.SUPABASE_JWT_AUDIENCE)
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  function buildApp(customDb?: PrismaClient): Express {
    const logger = pino({ level: 'silent' });
    const deps: AppDependencies = {
      env: mockEnv,
      logger,
      readinessCheck: async () => Promise.resolve({ ready: true }),
      customJwks: jwksFetcher,
    };
    if (customDb) {
      deps.customDb = customDb;
    }
    return createApp(deps);
  }

  describe('getCurrentProfile service', () => {
    it('returns onboarding REQUIRED profile shell for eligible first login', async () => {
      const mockDb = createMockDb({
        enrollments: [
          {
            id: 'e-1',
            quizId: 'q-1',
            normalizedEmail: 'student@thapar.edu',
            userId: null,
            rollNumber: '102300001',
            branchCode: 'CSE',
            rosterName: 'Student Name',
            status: 'ELIGIBLE',
            createdAt: new Date(),
          },
        ],
      });

      const profile = await getCurrentProfile(
        '550e8400-e29b-41d4-a716-446655440000',
        'student@thapar.edu',
        mockDb,
      );

      expect(profile).toMatchObject({
        id: '550e8400-e29b-41d4-a716-446655440000',
        email: 'student@thapar.edu',
        fullName: null,
        rollNumber: null,
        branchCode: null,
        phoneNumber: null,
        role: 'STUDENT',
        status: 'ACTIVE',
        onboardingStatus: 'REQUIRED',
        profileCompletedAt: null,
      });
    });

    it('returns existing completed profile for returning student', async () => {
      const completedDate = new Date();
      const mockDb = createMockDb({
        profiles: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            email: 'student@thapar.edu',
            normalizedEmail: 'student@thapar.edu',
            fullName: 'Student Name',
            rollNumber: '102300001',
            branchCode: 'CSE',
            phoneE164: '+919876543210',
            role: 'STUDENT',
            status: 'ACTIVE',
            profileCompletedAt: completedDate,
            createdAt: completedDate,
            updatedAt: completedDate,
          },
        ],
      });

      const profile = await getCurrentProfile(
        '550e8400-e29b-41d4-a716-446655440000',
        'student@thapar.edu',
        mockDb,
      );

      expect(profile.onboardingStatus).toBe('COMPLETED');
      expect(profile.fullName).toBe('Student Name');
    });

    it('returns 403 ACCOUNT_NOT_REGISTERED when no eligible roster exists', async () => {
      const mockDb = createMockDb();

      await expect(
        getCurrentProfile(
          '550e8400-e29b-41d4-a716-446655440000',
          'unregistered@thapar.edu',
          mockDb,
        ),
      ).rejects.toMatchObject({
        status: 403,
        code: 'ACCOUNT_NOT_REGISTERED',
      });
    });

    it('returns 403 ACCOUNT_NOT_REGISTERED when different user ID attempts to claim existing profile email', async () => {
      const mockDb = createMockDb({
        profiles: [
          {
            id: 'original-user-id',
            email: 'student@thapar.edu',
            normalizedEmail: 'student@thapar.edu',
            fullName: 'Original Student',
            rollNumber: '102300001',
            branchCode: 'CSE',
            phoneE164: '+919876543210',
            role: 'STUDENT',
            status: 'ACTIVE',
            profileCompletedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      });

      await expect(
        getCurrentProfile('different-user-id', 'student@thapar.edu', mockDb),
      ).rejects.toMatchObject({
        status: 403,
        code: 'ACCOUNT_NOT_REGISTERED',
      });
    });

    it('returns 403 ACCOUNT_NOT_REGISTERED when existing profile has a different normalizedEmail', async () => {
      const mockDb = createMockDb({
        profiles: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            email: 'old@thapar.edu',
            normalizedEmail: 'old@thapar.edu',
            fullName: 'Old Student',
            rollNumber: '102300001',
            branchCode: 'CSE',
            phoneE164: '+919876543210',
            role: 'STUDENT',
            status: 'ACTIVE',
            profileCompletedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      });

      await expect(
        getCurrentProfile('550e8400-e29b-41d4-a716-446655440000', 'new@thapar.edu', mockDb),
      ).rejects.toMatchObject({
        status: 403,
        code: 'ACCOUNT_NOT_REGISTERED',
      });
    });

    it('returns 403 ACCOUNT_BLOCKED when account is blocked', async () => {
      const mockDb = createMockDb({
        profiles: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            email: 'student@thapar.edu',
            normalizedEmail: 'student@thapar.edu',
            fullName: 'Blocked User',
            rollNumber: '102300001',
            branchCode: 'CSE',
            phoneE164: '+919876543210',
            role: 'STUDENT',
            status: 'BLOCKED',
            profileCompletedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      });

      await expect(
        getCurrentProfile('550e8400-e29b-41d4-a716-446655440000', 'student@thapar.edu', mockDb),
      ).rejects.toMatchObject({
        status: 403,
        code: 'ACCOUNT_BLOCKED',
      });
    });
  });

  describe('completeOnboarding service', () => {
    it('completes onboarding and links enrollments for eligible student', async () => {
      const mockDb = createMockDb({
        enrollments: [
          {
            id: 'e-1',
            quizId: 'q-1',
            normalizedEmail: 'student@thapar.edu',
            userId: null,
            rollNumber: '102300001',
            branchCode: 'CSE',
            rosterName: 'Student Name',
            status: 'ELIGIBLE',
            createdAt: new Date(),
          },
        ],
      });

      const { profile, created } = await completeOnboarding(
        '550e8400-e29b-41d4-a716-446655440000',
        'student@thapar.edu',
        {
          fullName: 'Student Name',
          rollNumber: '102300001',
          branchCode: 'CSE',
          phoneNumber: '+919876543210',
        },
        mockDb,
      );

      expect(created).toBe(true);
      expect(profile).toMatchObject({
        id: '550e8400-e29b-41d4-a716-446655440000',
        email: 'student@thapar.edu',
        fullName: 'Student Name',
        rollNumber: '102300001',
        branchCode: 'CSE',
        phoneNumber: '+919876543210',
        onboardingStatus: 'COMPLETED',
      });
      expect(profile.profileCompletedAt).not.toBeNull();
    });

    it('saves trusted roster values for rollNumber and branchCode when input casing differs', async () => {
      const mockDb = createMockDb({
        enrollments: [
          {
            id: 'e-1',
            quizId: 'q-1',
            normalizedEmail: 'student@thapar.edu',
            userId: null,
            rollNumber: 'ABC102300001',
            branchCode: 'COE',
            rosterName: 'Student Name',
            status: 'ELIGIBLE',
            createdAt: new Date(),
          },
        ],
      });

      const { profile } = await completeOnboarding(
        '550e8400-e29b-41d4-a716-446655440000',
        'student@thapar.edu',
        {
          fullName: 'Student Name',
          rollNumber: 'abc102300001',
          branchCode: 'coe',
          phoneNumber: '+919876543210',
        },
        mockDb,
      );

      expect(profile.rollNumber).toBe('ABC102300001');
      expect(profile.branchCode).toBe('COE');
    });

    it('returns 409 ROSTER_DETAILS_MISMATCH for incorrect roll or branch', async () => {
      const mockDb = createMockDb({
        enrollments: [
          {
            id: 'e-1',
            quizId: 'q-1',
            normalizedEmail: 'student@thapar.edu',
            userId: null,
            rollNumber: '102300001',
            branchCode: 'CSE',
            rosterName: 'Student Name',
            status: 'ELIGIBLE',
            createdAt: new Date(),
          },
        ],
      });

      await expect(
        completeOnboarding(
          '550e8400-e29b-41d4-a716-446655440000',
          'student@thapar.edu',
          {
            fullName: 'Student Name',
            rollNumber: '999999999',
            branchCode: 'CSE',
            phoneNumber: '+919876543210',
          },
          mockDb,
        ),
      ).rejects.toMatchObject({
        status: 409,
        code: 'ROSTER_DETAILS_MISMATCH',
      });
    });

    it('returns 409 ROLL_NUMBER_ALREADY_REGISTERED if another identity claimed the roll number', async () => {
      const mockDb = createMockDb({
        profiles: [
          {
            id: 'other-user-uuid',
            email: 'other@thapar.edu',
            normalizedEmail: 'other@thapar.edu',
            fullName: 'Other User',
            rollNumber: '102300001',
            branchCode: 'CSE',
            phoneE164: '+919876543210',
            role: 'STUDENT',
            status: 'ACTIVE',
            profileCompletedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        enrollments: [
          {
            id: 'e-1',
            quizId: 'q-1',
            normalizedEmail: 'student@thapar.edu',
            userId: null,
            rollNumber: '102300001',
            branchCode: 'CSE',
            rosterName: 'Student Name',
            status: 'ELIGIBLE',
            createdAt: new Date(),
          },
        ],
      });

      await expect(
        completeOnboarding(
          '550e8400-e29b-41d4-a716-446655440000',
          'student@thapar.edu',
          {
            fullName: 'Student Name',
            rollNumber: '102300001',
            branchCode: 'CSE',
            phoneNumber: '+919876543210',
          },
          mockDb,
        ),
      ).rejects.toMatchObject({
        status: 409,
        code: 'ROLL_NUMBER_ALREADY_REGISTERED',
      });
    });

    it('returns 409 CONFLICT for conflicting repeat onboarding submission', async () => {
      const completedDate = new Date();
      const mockDb = createMockDb({
        profiles: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            email: 'student@thapar.edu',
            normalizedEmail: 'student@thapar.edu',
            fullName: 'Student Name',
            rollNumber: '102300001',
            branchCode: 'CSE',
            phoneE164: '+919876543210',
            role: 'STUDENT',
            status: 'ACTIVE',
            profileCompletedAt: completedDate,
            createdAt: completedDate,
            updatedAt: completedDate,
          },
        ],
      });

      await expect(
        completeOnboarding(
          '550e8400-e29b-41d4-a716-446655440000',
          'student@thapar.edu',
          {
            fullName: 'Different Name',
            rollNumber: '102300001',
            branchCode: 'CSE',
            phoneNumber: '+919876543210',
          },
          mockDb,
        ),
      ).rejects.toMatchObject({
        status: 409,
        code: 'CONFLICT',
      });
    });

    it('is idempotent for repeated matching onboarding submissions', async () => {
      const completedDate = new Date();
      const mockDb = createMockDb({
        profiles: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            email: 'student@thapar.edu',
            normalizedEmail: 'student@thapar.edu',
            fullName: 'Student Name',
            rollNumber: '102300001',
            branchCode: 'CSE',
            phoneE164: '+919876543210',
            role: 'STUDENT',
            status: 'ACTIVE',
            profileCompletedAt: completedDate,
            createdAt: completedDate,
            updatedAt: completedDate,
          },
        ],
      });

      const { profile, created } = await completeOnboarding(
        '550e8400-e29b-41d4-a716-446655440000',
        'student@thapar.edu',
        {
          fullName: 'Student Name',
          rollNumber: '102300001',
          branchCode: 'CSE',
          phoneNumber: '+919876543210',
        },
        mockDb,
      );

      expect(created).toBe(false);
      expect(profile.onboardingStatus).toBe('COMPLETED');
    });

    it('returns 403 ACCOUNT_NOT_REGISTERED when profile email does not match JWT email', async () => {
      const mockDb = createMockDb({
        profiles: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            email: 'old@thapar.edu',
            normalizedEmail: 'old@thapar.edu',
            fullName: null,
            rollNumber: null,
            branchCode: null,
            phoneE164: null,
            role: 'STUDENT',
            status: 'ACTIVE',
            profileCompletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      });

      await expect(
        completeOnboarding(
          '550e8400-e29b-41d4-a716-446655440000',
          'new@thapar.edu',
          {
            fullName: 'Student Name',
            rollNumber: '102300001',
            branchCode: 'CSE',
            phoneNumber: '+919876543210',
          },
          mockDb,
        ),
      ).rejects.toMatchObject({ status: 403, code: 'ACCOUNT_NOT_REGISTERED' });
    });

    it('returns 403 ACCOUNT_NOT_REGISTERED when normalizedEmail is already owned by a different profile ID', async () => {
      const mockDb = createMockDb({
        profiles: [
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            email: 'student@thapar.edu',
            normalizedEmail: 'student@thapar.edu',
            fullName: 'Other Student',
            rollNumber: '102300002',
            branchCode: 'CSE',
            phoneE164: '+919876543211',
            role: 'STUDENT',
            status: 'ACTIVE',
            profileCompletedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      });

      await expect(
        completeOnboarding(
          '550e8400-e29b-41d4-a716-446655440000',
          'student@thapar.edu',
          {
            fullName: 'Student Name',
            rollNumber: '102300001',
            branchCode: 'CSE',
            phoneNumber: '+919876543210',
          },
          mockDb,
        ),
      ).rejects.toMatchObject({ status: 403, code: 'ACCOUNT_NOT_REGISTERED' });
    });

    it('returns 409 ROSTER_DETAILS_MISMATCH when one enrollment is already linked to a different user', async () => {
      const otherUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      const mockDb = createMockDb({
        enrollments: [
          {
            id: 'e-1',
            quizId: 'q-1',
            normalizedEmail: 'student@thapar.edu',
            userId: otherUserId,
            rollNumber: '102300001',
            branchCode: 'CSE',
            rosterName: 'Student Name',
            status: 'ELIGIBLE',
            createdAt: new Date(),
          },
        ],
      });

      await expect(
        completeOnboarding(
          '550e8400-e29b-41d4-a716-446655440000',
          'student@thapar.edu',
          {
            fullName: 'Student Name',
            rollNumber: '102300001',
            branchCode: 'CSE',
            phoneNumber: '+919876543210',
          },
          mockDb,
        ),
      ).rejects.toMatchObject({ status: 409, code: 'ROSTER_DETAILS_MISMATCH' });
    });

    it('returns 409 ROSTER_DETAILS_MISMATCH when conflicting roster rows exist for one email', async () => {
      const mockDb = createMockDb({
        enrollments: [
          {
            id: 'e-1',
            quizId: 'q-1',
            normalizedEmail: 'student@thapar.edu',
            userId: null,
            rollNumber: '102300001',
            branchCode: 'CSE',
            rosterName: 'Student Name',
            status: 'ELIGIBLE',
            createdAt: new Date(),
          },
          {
            id: 'e-2',
            quizId: 'q-2',
            normalizedEmail: 'student@thapar.edu',
            userId: null,
            rollNumber: '102300099', // Different roll — conflicting
            branchCode: 'CSE',
            rosterName: 'Student Name',
            status: 'ELIGIBLE',
            createdAt: new Date(),
          },
        ],
      });

      await expect(
        completeOnboarding(
          '550e8400-e29b-41d4-a716-446655440000',
          'student@thapar.edu',
          {
            fullName: 'Student Name',
            rollNumber: '102300001',
            branchCode: 'CSE',
            phoneNumber: '+919876543210',
          },
          mockDb,
        ),
      ).rejects.toMatchObject({ status: 409, code: 'ROSTER_DETAILS_MISMATCH' });
    });
  });

  describe('HTTP Endpoints (/v1/me and /v1/onboarding)', () => {
    it('GET /v1/me returns exact profile schema for eligible user', async () => {
      const mockDb = createMockDb({
        enrollments: [
          {
            id: 'e-1',
            quizId: 'q-1',
            normalizedEmail: 'student@thapar.edu',
            userId: null,
            rollNumber: '102300001',
            branchCode: 'CSE',
            rosterName: 'Student Name',
            status: 'ELIGIBLE',
            createdAt: new Date(),
          },
        ],
      });
      const app = buildApp(mockDb);
      const token = await createToken();

      const response = await supertest(app).get('/v1/me').set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: '550e8400-e29b-41d4-a716-446655440000',
        email: 'student@thapar.edu',
        fullName: null,
        rollNumber: null,
        branchCode: null,
        phoneNumber: null,
        role: 'STUDENT',
        status: 'ACTIVE',
        onboardingStatus: 'REQUIRED',
        profileCompletedAt: null,
      });
    });

    it('POST /v1/onboarding completes onboarding via HTTP endpoint', async () => {
      const mockDb = createMockDb({
        enrollments: [
          {
            id: 'e-1',
            quizId: 'q-1',
            normalizedEmail: 'student@thapar.edu',
            userId: null,
            rollNumber: '102300001',
            branchCode: 'CSE',
            rosterName: 'Student Name',
            status: 'ELIGIBLE',
            createdAt: new Date(),
          },
        ],
      });
      const app = buildApp(mockDb);
      const token = await createToken();

      const response = await supertest(app)
        .post('/v1/onboarding')
        .set('Authorization', `Bearer ${token}`)
        .send({
          fullName: 'Student Name',
          rollNumber: '102300001',
          branchCode: 'CSE',
          phoneNumber: '+919876543210',
        });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        id: '550e8400-e29b-41d4-a716-446655440000',
        email: 'student@thapar.edu',
        fullName: 'Student Name',
        rollNumber: '102300001',
        branchCode: 'CSE',
        phoneNumber: '+919876543210',
        onboardingStatus: 'COMPLETED',
      });
    });

    it('POST /v1/onboarding rejects email field in request body with 400', async () => {
      const app = buildApp();
      const token = await createToken();

      const response = await supertest(app)
        .post('/v1/onboarding')
        .set('Authorization', `Bearer ${token}`)
        .send({
          fullName: 'Student Name',
          rollNumber: '102300001',
          branchCode: 'CSE',
          phoneNumber: '+919876543210',
          email: 'hacker@malicious.com',
        });

      expect(response.status).toBe(400);
      const body = response.body as ProblemBody;
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('POST /v1/onboarding rejects invalid E.164 phone number with 400', async () => {
      const app = buildApp();
      const token = await createToken();

      const response = await supertest(app)
        .post('/v1/onboarding')
        .set('Authorization', `Bearer ${token}`)
        .send({
          fullName: 'Student Name',
          rollNumber: '102300001',
          branchCode: 'CSE',
          phoneNumber: '9876543210',
        });

      expect(response.status).toBe(400);
      const body = response.body as ProblemBody;
      expect(body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Admin Users Endpoints & Authorization', () => {
    const adminUserId = '11111111-1111-4111-a111-111111111111';
    const studentUserId = '22222222-2222-4222-a222-222222222222';
    const blockedAdminUserId = '33333333-3333-4333-a333-333333333333';

    async function createTokenForUser(sub: string, email: string): Promise<string> {
      return createToken({ sub, email });
    }

    function createAdminMockDb(): PrismaClient {
      const now = new Date();
      const adminProfile: Profile = {
        id: adminUserId,
        email: 'admin@thapar.edu',
        normalizedEmail: 'admin@thapar.edu',
        fullName: 'Admin User',
        rollNumber: '999900001',
        branchCode: 'CSE',
        phoneE164: '+919999999999',
        role: 'ADMIN',
        status: 'ACTIVE',
        profileCompletedAt: now,
        createdAt: now,
        updatedAt: now,
      };

      const studentProfile: Profile = {
        id: studentUserId,
        email: 'student@thapar.edu',
        normalizedEmail: 'student@thapar.edu',
        fullName: 'Student User',
        rollNumber: '102300001',
        branchCode: 'CSE',
        phoneE164: '+919876543210',
        role: 'STUDENT',
        status: 'ACTIVE',
        profileCompletedAt: now,
        createdAt: now,
        updatedAt: now,
      };

      const blockedAdminProfile: Profile = {
        id: blockedAdminUserId,
        email: 'blockedadmin@thapar.edu',
        normalizedEmail: 'blockedadmin@thapar.edu',
        fullName: 'Blocked Admin',
        rollNumber: '999900002',
        branchCode: 'CSE',
        phoneE164: '+919999999998',
        role: 'ADMIN',
        status: 'BLOCKED',
        profileCompletedAt: now,
        createdAt: now,
        updatedAt: now,
      };

      return createMockDb({
        profiles: [adminProfile, studentProfile, blockedAdminProfile],
      });
    }

    it('Student receives 403 on GET /v1/admin/users', async () => {
      const mockDb = createAdminMockDb();
      const app = buildApp(mockDb);
      const token = await createTokenForUser(studentUserId, 'student@thapar.edu');

      const response = await supertest(app)
        .get('/v1/admin/users')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
      const body = response.body as ProblemBody;
      expect(body.code).toBe('FORBIDDEN');
    });

    it('Student receives 403 on GET /v1/admin/users/:userId', async () => {
      const mockDb = createAdminMockDb();
      const app = buildApp(mockDb);
      const token = await createTokenForUser(studentUserId, 'student@thapar.edu');

      const response = await supertest(app)
        .get(`/v1/admin/users/${studentUserId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
      const body = response.body as ProblemBody;
      expect(body.code).toBe('FORBIDDEN');
    });

    it('Student receives 403 on PATCH /v1/admin/users/:userId', async () => {
      const mockDb = createAdminMockDb();
      const app = buildApp(mockDb);
      const token = await createTokenForUser(studentUserId, 'student@thapar.edu');

      const response = await supertest(app)
        .patch(`/v1/admin/users/${studentUserId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ fullName: 'New Name' });

      expect(response.status).toBe(403);
      const body = response.body as ProblemBody;
      expect(body.code).toBe('FORBIDDEN');
    });

    it('Blocked admin is denied with 403 ACCOUNT_BLOCKED', async () => {
      const mockDb = createAdminMockDb();
      const app = buildApp(mockDb);
      const token = await createTokenForUser(blockedAdminUserId, 'blockedadmin@thapar.edu');

      const response = await supertest(app)
        .get('/v1/admin/users')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
      const body = response.body as ProblemBody;
      expect(body.code).toBe('ACCOUNT_BLOCKED');
    });

    it('Admin token listing users returns paginated data and nextCursor', async () => {
      const mockDb = createAdminMockDb();
      const app = buildApp(mockDb);
      const token = await createTokenForUser(adminUserId, 'admin@thapar.edu');

      const response = await supertest(app)
        .get('/v1/admin/users?limit=2')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('nextCursor');
      const body = response.body as AdminListUsersResponse;
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBe(2);
      expect(body.nextCursor).not.toBeNull();
    });

    it('Admin token getting user detail returns single profile', async () => {
      const mockDb = createAdminMockDb();
      const app = buildApp(mockDb);
      const token = await createTokenForUser(adminUserId, 'admin@thapar.edu');

      const response = await supertest(app)
        .get(`/v1/admin/users/${studentUserId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: studentUserId,
        email: 'student@thapar.edu',
        fullName: 'Student User',
        role: 'STUDENT',
        status: 'ACTIVE',
      });
    });

    it('Getting non-existent user returns scoped 404', async () => {
      const mockDb = createAdminMockDb();
      const app = buildApp(mockDb);
      const token = await createTokenForUser(adminUserId, 'admin@thapar.edu');
      const nonExistentId = '00000000-0000-4000-a000-000000000000';

      const response = await supertest(app)
        .get(`/v1/admin/users/${nonExistentId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(404);
      const body = response.body as ProblemBody;
      expect(body.code).toBe('NOT_FOUND');
    });

    it('Valid correction via PATCH succeeds with 200', async () => {
      const mockDb = createAdminMockDb();
      const app = buildApp(mockDb);
      const token = await createTokenForUser(adminUserId, 'admin@thapar.edu');

      const response = await supertest(app)
        .patch(`/v1/admin/users/${studentUserId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          fullName: 'Updated Student Name',
          branchCode: 'ECE',
          role: 'ADMIN',
        });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: studentUserId,
        fullName: 'Updated Student Name',
        branchCode: 'ECE',
        role: 'ADMIN',
      });
    });

    it('Attempt to patch email field is rejected with 400', async () => {
      const mockDb = createAdminMockDb();
      const app = buildApp(mockDb);
      const token = await createTokenForUser(adminUserId, 'admin@thapar.edu');

      const response = await supertest(app)
        .patch(`/v1/admin/users/${studentUserId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'newemail@thapar.edu' });

      expect(response.status).toBe(400);
      const body = response.body as ProblemBody;
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('Attempt to patch id field is rejected with 400', async () => {
      const mockDb = createAdminMockDb();
      const app = buildApp(mockDb);
      const token = await createTokenForUser(adminUserId, 'admin@thapar.edu');

      const response = await supertest(app)
        .patch(`/v1/admin/users/${studentUserId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ id: '00000000-0000-4000-a000-000000000000' });

      expect(response.status).toBe(400);
      const body = response.body as ProblemBody;
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('Updating to duplicate roll number returns 409 conflict', async () => {
      const mockDb = createAdminMockDb();
      const app = buildApp(mockDb);
      const token = await createTokenForUser(adminUserId, 'admin@thapar.edu');

      const response = await supertest(app)
        .patch(`/v1/admin/users/${studentUserId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ rollNumber: '999900001' }); // Admin's roll number

      expect(response.status).toBe(409);
      const body = response.body as ProblemBody;
      expect(body.code).toBe('ROLL_NUMBER_ALREADY_REGISTERED');
    });
  });
});
