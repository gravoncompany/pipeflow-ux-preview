import { createServerFn } from "@tanstack/react-start";
import { diagnosisOptions } from "./diagnosis-automation";

export const getDiagnosisAutomation = createServerFn({ method: "GET" }).handler(async () => {
  const { diagnosisAutomationOverview } = await import("./diagnosis-automation.server");
  return diagnosisAutomationOverview();
});
export const saveDiagnosisAutomation = createServerFn({ method: "POST" })
  .inputValidator((v) => diagnosisOptions.parse(v)).handler(async ({ data }) => {
    const { updateDiagnosisAutomation } = await import("./diagnosis-automation.server");
    return updateDiagnosisAutomation(data);
  });