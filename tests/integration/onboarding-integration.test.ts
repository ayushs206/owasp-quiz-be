import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { ProblemError } from '../../src/shared/errors/problem.js';
import { completeOnboarding, getCurrentProfile } from '../../src/modules/users/service.js';

const prisma = new PrismaClient();
const describeDatabase = process.env.RUN_DATABASE_INTEGRATION === 'true' ? describe : describe.skip;

afterAll(async () => {
  await prisma.$disconnect();
});

describeDatabase('PostgreSQL Onboarding Integration & Concurrency Tests', () => {
  beforeEach(async () => {
    await prisma.quizEnrollment.deleteMany();
    await prisma.profile.deleteMany();
    await prisma.quiz.deleteMany();
    await prisma.quizSeries.deleteMany();
  });

  it('handles two simultaneous GET /v1/me requests idempotently', async () => {
    const email = 'concurrent-login@thapar.edu';
    const userId = '11111111-1111-4111-8111-111111111111';

    // Seed eligible roster
    await prisma.quizEnrollment.create({
      data: {
        quizId: '00000000-0000-0000-0000-000000000001',
        normalizedEmail: email,
        rollNumber: '102300001',
        branchCode: 'CSE',
        status: 'ELIGIBLE',
      },
    });

    const [res1, res2] = await Promise.all([
      getCurrentProfile(userId, email, prisma),
      getCurrentProfile(userId, email, prisma),
    ]);

    expect(res1.id).toBe(userId);
    expect(res2.id).toBe(userId);
    expect(res1.onboardingStatus).toBe('REQUIRED');
    expect(res2.onboardingStatus).toBe('REQUIRED');

    const count = await prisma.profile.count({ where: { id: userId } });
    expect(count).toBe(1);
  });

  it('prevents two users from claiming the same roll number concurrently', async () => {
    const user1Id = '11111111-1111-4111-8111-111111111111';
    const user2Id = '22222222-2222-4222-8222-222222222222';
    const email1 = 'student1@thapar.edu';
    const email2 = 'student2@thapar.edu';
    const rollNumber = '102300099';

    await prisma.quizEnrollment.createMany({
      data: [
        {
          quizId: '00000000-0000-0000-0000-000000000001',
          normalizedEmail: email1,
          rollNumber,
          branchCode: 'CSE',
          status: 'ELIGIBLE',
        },
        {
          quizId: '00000000-0000-0000-0000-000000000001',
          normalizedEmail: email2,
          rollNumber,
          branchCode: 'CSE',
          status: 'ELIGIBLE',
        },
      ],
    });

    const task1 = completeOnboarding(
      user1Id,
      email1,
      { fullName: 'User One', rollNumber, branchCode: 'CSE', phoneNumber: '+919876543210' },
      prisma,
    );

    const task2 = completeOnboarding(
      user2Id,
      email2,
      { fullName: 'User Two', rollNumber, branchCode: 'CSE', phoneNumber: '+919876543211' },
      prisma,
    );

    const results = await Promise.allSettled([task1, task2]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const rejectedError: unknown = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejectedError).toBeInstanceOf(ProblemError);
    expect((rejectedError as ProblemError).status).toBe(409);
    expect((rejectedError as ProblemError).code).toBe('ROLL_NUMBER_ALREADY_REGISTERED');
  });

  it('rejects onboarding when conflicting roster rows exist for one email', async () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const email = 'conflicting-roster@thapar.edu';

    await prisma.quizEnrollment.createMany({
      data: [
        {
          quizId: '00000000-0000-0000-0000-000000000001',
          normalizedEmail: email,
          rollNumber: '102300001',
          branchCode: 'CSE',
          status: 'ELIGIBLE',
        },
        {
          quizId: '00000000-0000-0000-0000-000000000002',
          normalizedEmail: email,
          rollNumber: '102300002', // Conflicting roll number
          branchCode: 'CSE',
          status: 'ELIGIBLE',
        },
      ],
    });

    await expect(
      completeOnboarding(
        userId,
        email,
        {
          fullName: 'Student Name',
          rollNumber: '102300001',
          branchCode: 'CSE',
          phoneNumber: '+919876543210',
        },
        prisma,
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: 'ROSTER_DETAILS_MISMATCH',
    });

    const profile = await prisma.profile.findUnique({ where: { id: userId } });
    expect(profile?.profileCompletedAt).toBeNull();
  });

  it('rejects onboarding if an enrollment is already linked to another user', async () => {
    const user1Id = '11111111-1111-4111-8111-111111111111';
    const user2Id = '22222222-2222-4222-8222-222222222222';
    const email = 'shared-enrollment@thapar.edu';

    await prisma.profile.create({
      data: {
        id: user1Id,
        email,
        normalizedEmail: email,
        fullName: 'User One',
        rollNumber: '102300001',
        branchCode: 'CSE',
        phoneE164: '+919876543210',
        role: 'STUDENT',
        status: 'ACTIVE',
        profileCompletedAt: new Date(),
      },
    });

    await prisma.quizEnrollment.create({
      data: {
        quizId: '00000000-0000-0000-0000-000000000001',
        normalizedEmail: email,
        userId: user1Id, // Already linked to user 1
        rollNumber: '102300001',
        branchCode: 'CSE',
        status: 'ELIGIBLE',
      },
    });

    await expect(
      completeOnboarding(
        user2Id,
        email,
        {
          fullName: 'User Two',
          rollNumber: '102300001',
          branchCode: 'CSE',
          phoneNumber: '+919876543211',
        },
        prisma,
      ),
    ).rejects.toMatchObject({
      status: 409,
    });
  });
});
