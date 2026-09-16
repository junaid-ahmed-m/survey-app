import { Link } from 'react-router-dom';
import { PublicShell } from '../../components/PublicShell';
import { StateCard } from '../../components/StateCard';

export default function NotFoundPage() {
  return (
    <PublicShell>
      <StateCard
        tone="info"
        title="Page not found"
        message="The link you followed does not exist."
        action={
          <Link className="btn-primary" to="/">
            Go to home
          </Link>
        }
      />
    </PublicShell>
  );
}
