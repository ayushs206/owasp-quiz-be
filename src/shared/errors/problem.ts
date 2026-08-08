export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  requestId: string;
}

export interface ProblemErrorOptions {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
}

export class ProblemError extends Error {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly detail: string | undefined;

  constructor(options: ProblemErrorOptions) {
    super(options.detail ?? options.title);
    this.name = 'ProblemError';
    this.type = options.type;
    this.title = options.title;
    this.status = options.status;
    this.code = options.code;
    this.detail = options.detail;
  }

  toBody(requestId: string): ProblemBody {
    return {
      type: this.type,
      title: this.title,
      status: this.status,
      code: this.code,
      ...(this.detail === undefined ? {} : { detail: this.detail }),
      requestId,
    };
  }
}
