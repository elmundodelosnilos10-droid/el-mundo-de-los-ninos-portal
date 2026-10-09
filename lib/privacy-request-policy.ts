export type PrivacyRequestStatus = "recibida" | "en_revision" | "respondida" | "cerrada";

const allowedTransitions: Record<PrivacyRequestStatus, PrivacyRequestStatus[]> = {
  recibida: ["en_revision", "respondida", "cerrada"],
  en_revision: ["respondida", "cerrada"],
  respondida: ["cerrada"],
  cerrada: [],
};

export function canTransitionPrivacyRequest(from: PrivacyRequestStatus, to: PrivacyRequestStatus) {
  return allowedTransitions[from].includes(to);
}
