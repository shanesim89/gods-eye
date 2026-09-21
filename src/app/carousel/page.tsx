import { requireUser } from "@/lib/auth";
import CarouselGenerator from "./CarouselGenerator";

export const dynamic = "force-dynamic";

export default async function CarouselStudioPage() {
  await requireUser();

  return <CarouselGenerator />;
}
