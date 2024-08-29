import Connect from "@/components/Connect";

export default function Home() {
  return (
    <>
      <div className="card">
        <hr />
        <h3>Simple LitNodeClient Connection</h3>
        <Connect />
        <h5> Check the browser console! </h5>
        <hr />
      </div>
    </>
  );
}
