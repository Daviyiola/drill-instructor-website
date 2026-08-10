import {redirect} from "next/navigation";

export const metadata = {
  title: "Contact",
  description: "Contact Drill Instructor support.",
};

export default function ContactPage() {
  redirect("/support");
}
