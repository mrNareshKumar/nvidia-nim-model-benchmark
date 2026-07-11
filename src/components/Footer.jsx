export default function Footer({ timestamp }) {
  return (
    <div className="footer">
      Prompt: <span>"What is the capital of India? Please answer in one sentence."</span>
      &nbsp;·&nbsp; API: <span>integrate.api.nvidia.com/v1</span>
      {timestamp && (
        <>
          &nbsp;·&nbsp; Data: <span>{timestamp}</span>
        </>
      )}
    </div>
  );
}
