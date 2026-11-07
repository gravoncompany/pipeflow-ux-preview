import { createFileRoute, Outlet } from "@tanstack/react-router";
export const Route = createFileRoute("/pos-venda")({ component: () => <Outlet /> });