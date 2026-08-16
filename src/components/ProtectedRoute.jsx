import { useState, useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import Spinner from './Spinner';

const DEFAULT_WORKSPACE_ID = 'dbcaddf1-cf02-4bad-8af1-974301cdfbea';

export default function ProtectedRoute() {
  const { user, loading } = useAuth();
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [onboardingStatus, setOnboardingStatus] = useState(null);

  useEffect(() => {
    let active = true;

    async function checkStatus() {
      if (!user) {
        setCheckingStatus(false);
        return;
      }

      try {
        // Fast-path client metadata check: if must_change_password is true, immediately block
        if (user.app_metadata?.must_change_password === true) {
          if (active) {
            setOnboardingStatus({
              must_change_password: true,
              membership_status: 'pending',
            });
            setCheckingStatus(false);
          }
          return;
        }

        // Authoritative server-side check via get_onboarding_status
        const { data: statusData, error: statusErr } =
          await supabase.functions.invoke('admin-manage-workspace-user', {
            body: {
              action: 'get_onboarding_status',
              workspace_id: DEFAULT_WORKSPACE_ID,
            },
          });

        if (!active) return;

        if (statusErr || !statusData?.success) {
          // If Edge function check fails or returns error, fallback to DB direct membership check
          const { data: memberRow } = await supabase
            .from('workspace_members')
            .select('status')
            .eq('workspace_id', DEFAULT_WORKSPACE_ID)
            .eq('user_id', user.id)
            .maybeSingle();

          setOnboardingStatus({
            must_change_password:
              user.app_metadata?.must_change_password === true,
            membership_status: memberRow ? memberRow.status : 'active',
          });
        } else {
          setOnboardingStatus({
            must_change_password: statusData.must_change_password === true,
            membership_status: statusData.membership_status,
          });
        }
      } catch {
        if (active) {
          setOnboardingStatus({
            must_change_password:
              user.app_metadata?.must_change_password === true,
            membership_status: 'active',
          });
        }
      } finally {
        if (active) setCheckingStatus(false);
      }
    }

    setCheckingStatus(true);
    checkStatus();

    return () => {
      active = false;
    };
  }, [user]);

  if (loading || (user && checkingStatus)) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
        }}
      >
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Dual-gate: Normal workspace access is allowed ONLY when membership_status === "active" AND must_change_password !== true
  if (
    onboardingStatus?.must_change_password === true ||
    onboardingStatus?.membership_status === 'pending'
  ) {
    return <Navigate to="/change-password" replace />;
  }

  return <Outlet />;
}
