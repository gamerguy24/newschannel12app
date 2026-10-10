import { useEffect } from 'react';
import { Panel } from '../components/ui/Primitives';
import './StreamsPage.css';

export function StreamsPage() {
  useEffect(() => {
    // Tell the Facebook SDK to re-parse the DOM for newly added .fb-video elements
    const fb = (window as any).FB;
    if (fb) {
      fb.XFBML.parse();
    }
  }, []);

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
          <div className="nc-streams__embed-container">
            <div
              className="fb-video"
              data-href="https://www.facebook.com/LarontaBarbee/videos/2595785844253563/"
              data-width="800"
              data-show-text="false"
              data-allowfullscreen="true"
              data-autoplay="true"
            ></div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

export default StreamsPage;
