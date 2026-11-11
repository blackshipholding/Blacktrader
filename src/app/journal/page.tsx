// Alte Adresse (Lesezeichen, ältere Push-Nachrichten): weiter zum Depot.
import { redirect } from "next/navigation";

export default function JournalRedirect() {
  redirect("/depot");
}
