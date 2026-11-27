import { buildDatasets } from "./datasets/datasets";
import { toAccountFields } from "./export-fields";
import { buildControllerNotice, buildDataSubjectRights } from "./export-notice";
import { ExportableUser } from "./export-user.query";
import { buildPrivacySection } from "./privacy-section";
import { buildProfileSection } from "./profile-section";

export function buildExportPayload(user: ExportableUser, mfaFeatureEnabled: boolean) {
  return {
    exportedAt: new Date().toISOString(),
    controller: buildControllerNotice(),
    privacy: buildPrivacySection(toAccountFields(user)),
    rights: buildDataSubjectRights(),
    // As listas vao em `datasets`; o `profile` fica so com os dados da conta.
    profile: buildProfileSection(user, mfaFeatureEnabled),
    datasets: buildDatasets(user),
  };
}
