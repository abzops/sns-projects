import styles from './RoleBadge.module.css';

const ROLE_CONFIGS = {
  // System roles
  ceo: { label: 'CEO', className: styles.ceo },
  cto: { label: 'CTO', className: styles.cto },
  system_admin: { label: 'System Admin', className: styles.systemAdmin },
  project_admin: { label: 'Project Admin', className: styles.projectAdmin },
  
  // Workspace roles
  owner: { label: 'Owner', className: styles.owner },
  admin: { label: 'Admin', className: styles.admin },
  member: { label: 'Member', className: styles.member },
  viewer: { label: 'Viewer', className: styles.viewer },

  // Department roles
  head: { label: 'Dept Head', className: styles.head },
  lead: { label: 'Dept Lead', className: styles.lead },
};

export default function RoleBadge({ role, size = 'sm', customLabel = null }) {
  if (!role) return null;
  const key = String(role).toLowerCase();
  const config = ROLE_CONFIGS[key] || { label: role, className: styles.default };

  return (
    <span className={`${styles.badge} ${config.className} ${styles[size] || styles.sm}`}>
      {customLabel || config.label}
    </span>
  );
}
