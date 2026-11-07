import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { managementUpdateSchema } from "./customer-success-management";
import { analyzeManagement, saveManagement } from "./customer-success-management.server";
export const updateCsManagement = createServerFn({ method: "POST" }).inputValidator(i => managementUpdateSchema.parse(i)).handler(({ data }) => saveManagement(data));
export const analyzeCsManagement = createServerFn({ method: "POST" }).inputValidator(i => z.object({ clientId: z.string().uuid(), eventId: z.string().uuid() }).strict().parse(i)).handler(({ data }) => analyzeManagement(data.clientId, data.eventId));