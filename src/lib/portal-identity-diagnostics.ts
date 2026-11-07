export type PortalIdentityDiagnostic = {
  code: string;
  stage: string;
  message: string;
  instance?: string;
  messageId?: string;
  expectedPhone?: string;
  httpStatus?: number;
  records?: number;
  checks?: Record<string, string | boolean>;
};

export class PortalIdentityError extends Error {
  constructor(public diagnostic: PortalIdentityDiagnostic) {
    super(diagnostic.message);
    this.name = "PortalIdentityError";
  }
}

export function safePortalIdentityDiagnostic(error: unknown): PortalIdentityDiagnostic {
  return error instanceof PortalIdentityError ? error.diagnostic : {
    code: "verification_unavailable", stage: "Verificação",
    message: "A verificação foi interrompida por uma falha interna ou de comunicação. Nenhum identificador foi liberado.",
  };
}