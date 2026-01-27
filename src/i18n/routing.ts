import { createNavigation } from "next-intl/navigation";
import { type Routing, routing } from "./routing-config";

export const { Link, redirect, useRouter, usePathname } = createNavigation(routing);

export { routing, type Routing };
