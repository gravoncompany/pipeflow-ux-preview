import { createServerFn } from "@tanstack/react-start";
import { analyzePortfolio } from "./cs-portfolio-strategy.server";
export const analyzeCsPortfolio = createServerFn({ method: "POST" }).handler(() => analyzePortfolio());
