/**
 * Importing npm packages
 */
import { describe, expect, it } from 'bun:test';

/**
 * Importing user defined packages
 */
import { PLATFORM_ORG_NAME } from '@server/modules/admin';
import { OAuthClientService } from '@server/modules/auth/oauth';
import { PolicyDecisionService } from '@server/modules/authz';
import { BootstrapService } from '@server/modules/bootstrap';
import { OrganisationService } from '@server/modules/identity/organisation';
import { UserService } from '@server/modules/identity/user';
import { schema } from '@server/modules/infrastructure/datastore';
import { ApplicationRoleService, ApplicationService } from '@server/modules/system/application';

import { TestEnvironment } from '../test-environment';

/**
 * Defining types
 */

/**
 * Declaring the constants
 */
const env = new TestEnvironment('bootstrap').init();
const ADMIN_EMAIL = 'admin@shadow-apps.com';

describe('BootstrapService', () => {
  it('should provision the platform application with the IAM admin role', () => {
    const application = env.getService(ApplicationService).getApplication('shadow-identity');
    expect(application).not.toBeNull();
    expect(application?.roles.map(role => role.roleName)).toContain('IAMAdmin');
  });

  it('should provision an active, verified bootstrap administrator', async () => {
    const admin = await env.getService(UserService).getUser(ADMIN_EMAIL);
    expect(admin).not.toBeNull();
    expect(admin?.status).toBe('ACTIVE');

    const emails = await env.getPostgresClient().select().from(schema.userEmails);
    const adminEmail = emails.find(email => email.emailId === ADMIN_EMAIL);
    expect(adminEmail?.verifiedAt).not.toBeNull();
  });

  it('should not seed the old hardcoded super-admin credentials', async () => {
    const superAdmin = await env.getService(UserService).getUser('super-admin@shadow-apps.com');
    expect(superAdmin).toBeNull();
  });

  it('should provision the platform organisation with the admin as owner', async () => {
    const organisation = await env.getService(OrganisationService).findTeamByName(PLATFORM_ORG_NAME);
    expect(organisation).not.toBeNull();

    const admin = await env.getService(UserService).getUser(ADMIN_EMAIL);
    expect(admin).not.toBeNull();
    const membership = organisation && admin ? await env.getService(OrganisationService).getMembership(admin.id, organisation.id) : null;
    expect(membership?.role).toBe('OWNER');
  });

  it('should be idempotent when run again', async () => {
    const bootstrap = new BootstrapService(
      env.getService(ApplicationService),
      env.getService(ApplicationRoleService),
      env.getService(UserService),
      env.getService(OAuthClientService),
      env.getService(PolicyDecisionService),
      env.getService(OrganisationService),
    );
    await bootstrap.onModuleInit();

    const admins = (await env.getPostgresClient().select().from(schema.userEmails)).filter(email => email.emailId === ADMIN_EMAIL);
    expect(admins).toHaveLength(1);

    const applications = (await env.getPostgresClient().select().from(schema.applications)).filter(app => app.name === 'shadow-identity');
    expect(applications).toHaveLength(1);

    const organisations = (await env.getPostgresClient().select().from(schema.organisations)).filter(org => org.name === PLATFORM_ORG_NAME);
    expect(organisations).toHaveLength(1);
  });

  it('should register first-party API resources and the service-only publish scope, but no consumer clients', async () => {
    /** Resources are seeded declaratively so audience/scope validation has something to validate against; clients (with secrets) stay console-registered. */
    const applications = await env.getPostgresClient().select().from(schema.applications);
    expect(applications.map(app => app.name).sort()).toEqual(['novel-forge', 'shadow-identity', 'webnovel']);

    const resources = await env.getPostgresClient().select().from(schema.apiResources);
    expect(resources.map(resource => resource.identifier).sort()).toEqual(['novel-forge-server', 'shadow-identity', 'webnovel-server']);

    const publishScope = (await env.getPostgresClient().select().from(schema.scopes)).find(scope => scope.name === 'webnovel:publish');
    expect(publishScope?.principalType).toBe('SERVICE');

    /** No consumer clients are auto-provisioned — client credentials remain a console/admin responsibility. */
    const clients = await env.getPostgresClient().select().from(schema.oauthClients);
    expect(clients).toHaveLength(0);

    const accessRules = await env.getPostgresClient().select().from(schema.serviceRouteAccess);
    expect(accessRules).toHaveLength(0);
  });
});
