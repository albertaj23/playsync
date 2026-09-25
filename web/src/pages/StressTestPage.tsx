import { useSearchParams } from 'react-router-dom';
import { StressStory } from './stress/StressStory';
import { useCountExperiment } from './stress/useCountExperiment';
import { useStreamExperiment } from './stress/useStreamExperiment';

/** `/stress?exp=count` picks the "Counting plays" story; the default is "Pressing Play together". */
export default function StressTestPage() {
  const [params, setParams] = useSearchParams();
  const choice = params.get('exp') === 'count' ? 'count' : 'stream';
  // Both hooks stay mounted so switching stories keeps each one's last result.
  const stream = useStreamExperiment();
  const count = useCountExperiment();
  return (
    <StressStory key={choice} exp={choice === 'stream' ? stream : count} choice={choice}
      onChoose={(k) => setParams(k === 'count' ? { exp: 'count' } : {}, { replace: true })} />
  );
}
