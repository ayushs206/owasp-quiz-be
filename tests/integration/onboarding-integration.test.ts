import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  adminUpdateUser,
  completeOnboarding,
  getCurrentProfile,
} from '../../src/modules/users/service.js';
import { ProblemError } from '../../src/shared/errors/problem.js';

const prisma = new PrismaClient();
const describeDatabase = process.env.RUN_DATABASE_INTEGRATION === 'true' ? describe : describe.skip;

const adminId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const quizOneId = '00000000-0000-4000-8000-000000000001';
const quizTwoId = '00000000-0000-4000-8000-000000000002';

async function createQuiz(quizId: string, title: string): Promise<void> {
  const series = await prisma.quizSeries.create({
    data: {
      title: `${title} Series`,
      createdBy: adminId,
    },
  });

  await prisma.quiz.create({
    data: {
      id: quizId,
      seriesId: series.id,
      title,
      durationMinutes: 30,
      startsAt: new Date('2026-08-10T00:00:00Z'),
      endsAt: new Date('2026-08-11T00:00:00Z'),
      createdBy: adminId,
    },
  });
}

afterAll(async () => {
  await prisma.$disconnect();
});

describeDatabase('PostgreSQL onboarding integration and concurrency', () => {
  beforeEach(async () => {
    await prisma.quizEnrollment.deleteMany();
    await prisma.quiz.deleteMany();
    await prisma.quizSeries.deleteMany();
    await prisma.profile.deleteMany();

    await prisma.profile.create({
      data: {
        id: adminId,
        email: 'admin@thapar.edu',
        normalizedEmail: 'admin@thapar.edu',
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
  });

  it('handles two simultaneous profile-shell requests idempotently', async () => {
    const email = 'concurrent-login@thapar.edu';
    const userId = '11111111-1111-4111-8111-111111111111';
    await createQuiz(quizOneId, 'Concurrent Login');
    await prisma.quizEnrollment.create({
      data: {
        quizId: quizOneId,
        normalizedEmail: email,
        rollNumber: '102300001',
        branchCode: 'CSE',
        status: 'ELIGIBLE',
      },
    });

    const [first, second] = await Promise.all([
      getCurrentProfile(userId, email, prisma),
      getCurrentProfile(userId, email, prisma),
    ]);

    expect(first.onboardingStatus).toBe('REQUIRED');
    expect(second.onboardingStatus).toBe('REQUIRED');
    expect(await prisma.profile.count({ where: { id: userId } })).toBe(1);
  });

  it('allows only one user to claim a roll number concurrently', async () => {
    const userOneId = '11111111-1111-4111-8111-111111111111';
    const userTwoId = '22222222-2222-4222-8222-222222222222';
    const rollNumber = '102300099';
    await createQuiz(quizOneId, 'Roll Claim One');
    await createQuiz(quizTwoId, 'Roll Claim Two');
    await prisma.quizEnrollment.createMany({
      data: [
        {
          quizId: quizOneId,
          normalizedEmail: 'student1@thapar.edu',
          rollNumber,
          branchCode: 'CSE',
          status: 'ELIGIBLE',
        },
        {
          quizId: quizTwoId,
          normalizedEmail: 'student2@thapar.edu',
          rollNumber,
          branchCode: 'CSE',
          status: 'ELIGIBLE',
        },
      ],
    });

    const results = await Promise.allSettled([
      completeOnboarding(
        userOneId,
        'student1@thapar.edu',
        {
          fullName: 'User One',
          rollNumber,
          branchCode: 'CSE',
          phoneNumber: '+919876543210',
        },
        prisma,
      ),
      completeOnboarding(
        userTwoId,
        'student2@thapar.edu',
        {
          fullName: 'User Two',
          rollNumber,
          branchCode: 'CSE',
          phoneNumber: '+919876543211',
        },
        prisma,
      ),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected?.reason).toBeInstanceOf(ProblemError);
    expect(rejected?.reason).toMatchObject({
      status: 409,
      code: 'ROLL_NUMBER_ALREADY_REGISTERED',
    });
  });

  it('serializes conflicting onboarding submissions for one identity', async () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const email = 'same-identity@thapar.edu';
    await createQuiz(quizOneId, 'Same Identity');
    await prisma.quizEnrollment.create({
      data: {
        quizId: quizOneId,
        normalizedEmail: email,
        rollNumber: '102300001',
        branchCode: 'CSE',
        status: 'ELIGIBLE',
      },
    });

    const results = await Promise.allSettled([
      completeOnboarding(
        userId,
        email,
        {
          fullName: 'First Submission',
          rollNumber: '102300001',
          branchCode: 'CSE',
          phoneNumber: '+919876543210',
        },
        prisma,
      ),
      completeOnboarding(
        userId,
        email,
        {
          fullName: 'Second Submission',
          rollNumber: '102300001',
          branchCode: 'CSE',
          phoneNumber: '+919876543211',
        },
        prisma,
      ),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected?.reason).toMatchObject({ status: 409, code: 'CONFLICT' });
  });

  it('stores canonical roster roll and branch values', async () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const email = 'canonical@thapar.edu';
    await createQuiz(quizOneId, 'Canonical Values');
    await prisma.quizEnrollment.create({
      data: {
        quizId: quizOneId,
        normalizedEmail: email,
        rollNumber: 'ABC1023',
        branchCode: 'CSE',
        status: 'ELIGIBLE',
      },
    });

    await completeOnboarding(
      userId,
      email,
      {
        fullName: 'Canonical Student',
        rollNumber: 'abc1023',
        branchCode: 'cse',
        phoneNumber: '+919876543210',
      },
      prisma,
    );

    const profile = await prisma.profile.findUniqueOrThrow({ where: { id: userId } });
    expect(profile.rollNumber).toBe('ABC1023');
    expect(profile.branchCode).toBe('CSE');
  });

  it('rejects conflicting roster rows for one email', async () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const email = 'conflicting-roster@thapar.edu';
    await createQuiz(quizOneId, 'Conflict One');
    await createQuiz(quizTwoId, 'Conflict Two');
    await prisma.quizEnrollment.createMany({
      data: [
        {
          quizId: quizOneId,
          normalizedEmail: email,
          rollNumber: '102300001',
          branchCode: 'CSE',
          status: 'ELIGIBLE',
        },
        {
          quizId: quizTwoId,
          normalizedEmail: email,
          rollNumber: '102300002',
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
    ).rejects.toMatchObject({ status: 409, code: 'ROSTER_DETAILS_MISMATCH' });

    expect(await prisma.profile.findUnique({ where: { id: userId } })).toBeNull();
  });

  it('does not relink an enrollment owned by another user', async () => {
    const ownerId = '11111111-1111-4111-8111-111111111111';
    const claimantId = '22222222-2222-4222-8222-222222222222';
    const email = 'shared-enrollment@thapar.edu';
    await createQuiz(quizOneId, 'Linked Enrollment');
    await prisma.profile.create({
      data: {
        id: ownerId,
        email: 'owner@thapar.edu',
        normalizedEmail: 'owner@thapar.edu',
        role: 'STUDENT',
        status: 'ACTIVE',
      },
    });
    const enrollment = await prisma.quizEnrollment.create({
      data: {
        quizId: quizOneId,
        normalizedEmail: email,
        userId: ownerId,
        rollNumber: '102300001',
        branchCode: 'CSE',
        status: 'ELIGIBLE',
      },
    });

    await expect(
      completeOnboarding(
        claimantId,
        email,
        {
          fullName: 'Claimant',
          rollNumber: '102300001',
          branchCode: 'CSE',
          phoneNumber: '+919876543211',
        },
        prisma,
      ),
    ).rejects.toMatchObject({ status: 409, code: 'ROSTER_DETAILS_MISMATCH' });

    const unchanged = await prisma.quizEnrollment.findUniqueOrThrow({
      where: { id: enrollment.id },
    });
    expect(unchanged.userId).toBe(ownerId);
  });

  it('preserves verified identity and emits a structured audit log for admin corrections', async () => {
    const targetUserId = '11111111-1111-4111-8111-111111111111';
    const requestId = '99999999-9999-4999-8999-999999999999';
    await prisma.profile.create({
      data: {
        id: targetUserId,
        email: 'student@thapar.edu',
        normalizedEmail: 'student@thapar.edu',
        fullName: 'Original Name',
        rollNumber: '102300001',
        branchCode: 'CSE',
        phoneE164: '+919876543210',
        role: 'STUDENT',
        status: 'ACTIVE',
        profileCompletedAt: new Date(),
      },
    });
    const info = vi.fn();

    const updated = await adminUpdateUser(
      adminId,
      targetUserId,
      { fullName: 'Corrected Name', branchCode: 'ECE' },
      requestId,
      { info },
      prisma,
    );

    expect(updated).toMatchObject({
      id: targetUserId,
      email: 'student@thapar.edu',
      fullName: 'Corrected Name',
      branchCode: 'ECE',
    });
    expect(info).toHaveBeenCalledWith(
      {
        actionType: 'ADMIN_UPDATE_USER',
        actorId: adminId,
        targetId: targetUserId,
        requestId,
        updatedFields: ['fullName', 'branchCode'],
      },
      'Privileged action: User profile updated by admin',
    );
  });
});
