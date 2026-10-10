import { Panel } from '../components/ui/Primitives';
import './StreamsPage.css';

export function StreamsPage() {
  return (
    <div className="nc-page nc-streams">
      <header className="nc-page__head">
        <div>
          <h1 className="nc-page__title">Live Streams</h1>
          <p className="nc-page__sub">Watch Laronta Barbee's live streams</p>
        </div>
      </header>

      <div className="nc-streams__layout">
        <Panel className="nc-streams__stage">
          <div className="nc-streams__embed-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white', textAlign: 'center', padding: '2rem' }}>
            <h2 style={{ marginBottom: '1rem' }}>Stream Setup Required</h2>
            <p>To display the live stream here, we need a <strong>public playback URL</strong> or an <strong>Embed Code</strong> (like a YouTube Video ID or a Restream Embed Player URL).</p>
            <p style={{ marginTop: '1rem', color: '#ffaaaa' }}>⚠️ The <strong>Stream Key</strong> you generated is for your broadcasting software (OBS). It cannot be used to display the video to viewers!</p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

export default StreamsPage;
