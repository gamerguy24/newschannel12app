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
        <Panel
          className="nc-streams__stage"
          eyebrow="Facebook"
          title="Laronta Barbee on Facebook"
          action={
            <a
              href="https://www.facebook.com/100014665188516/videos/2209040956701718"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open on Facebook
            </a>
          }
        >
          <div className="nc-streams__embed-container">
            <iframe
              src={`https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(
                'https://www.facebook.com/100014665188516/videos/2209040956701718',
              )}&show_text=false`}
              title="Laronta Barbee video on Facebook"
              loading="lazy"
              allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
        </Panel>

        <Panel
          className="nc-streams__stage"
          eyebrow="YouTube"
          title="Laronta Barbee on YouTube"
          action={
            <a
              href="https://www.youtube.com/watch?v=x85WIHpKGA4"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open on YouTube
            </a>
          }
        >
          <div className="nc-streams__embed-container">
            <iframe
              src="https://www.youtube-nocookie.com/embed/x85WIHpKGA4"
              title="Laronta Barbee video on YouTube"
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
        </Panel>
      </div>
    </div>
  );
}

export default StreamsPage;
