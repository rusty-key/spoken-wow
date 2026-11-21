import { Loading } from "@/components/Loading";
import { Contained } from "@/components/Width";

/** Shown while the server renders the page: its filter options come from the database. */
export default function PageLoading() {
  return (
    <main className="pt-6 pb-36">
      <Contained>
        <Loading label="Loading pages…" />
      </Contained>
    </main>
  );
}
