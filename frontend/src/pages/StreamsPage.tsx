import { Panel } from '../components/ui/Primitives';
import { FacebookEmbed } from 'react-social-media-embed';
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
          <div className="nc-streams__embed-container">
            <FacebookEmbed 
              url="https://www.facebook.com/LarontaBarbee/videos/2595785844253563/" 
              width="100%" 
            />
          </div>
        </Panel>
      </div>
    </div>
  );
}

export default StreamsPage;
