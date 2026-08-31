// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAuth } from '../../core/auth/store'
import { db } from '../../core/db/db'
import { queries } from '../../core/db/queries'
import { registry } from '../../core/plugin-host/registry'
import { useSettings } from '../../core/settings/store'
import { PluginBar } from '../../shell/PluginBar'
import { Organization } from '../Organization'

const OWNER = { userId: 'user-owner', email: 'owner@example.com' }

function signIn(userId: string, email: string) {
  useAuth.setState({
    session: {
      accessToken: 'token',
      refreshToken: 'refresh',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      userId,
      email,
    },
  })
}

beforeEach(async () => {
  await db.open()
  await Promise.all([db.organizations.clear(), db.memberships.clear(), db.syncOutbox.clear()])
  localStorage.clear()
  useSettings.setState({ hiddenPluginIds: [], pluginOrder: [] })
  signIn(OWNER.userId, OWNER.email)
})

afterEach(() => {
  cleanup()
  useAuth.setState({ session: null })
})

async function seedOrg(seats = 5) {
  return queries.createOrganization({
    name: 'Acme',
    plan: 'team',
    seats,
    ownerEmail: OWNER.email,
    ownerUserId: OWNER.userId,
  })
}

describe('creating an organisation', () => {
  it('offers the create panel when there is none', async () => {
    render(<Organization onBack={() => {}} onSignIn={() => {}} />)
    expect(await screen.findByText('Work with other people')).toBeInTheDocument()
  })

  it('makes the person who creates it the owner', async () => {
    const user = userEvent.setup()
    render(<Organization onBack={() => {}} onSignIn={() => {}} />)

    await user.type(await screen.findByLabelText('Organisation name'), 'Acme')
    await user.click(screen.getByRole('button', { name: 'Create organisation' }))

    await waitFor(async () => {
      const org = await queries.currentOrganization()
      expect(org?.name).toBe('Acme')
    })

    const org = await queries.currentOrganization()
    const roster = await queries.listMemberships(org!.id)
    expect(roster).toHaveLength(1)
    expect(roster[0]!.role).toBe('owner')
    expect(roster[0]!.email).toBe(OWNER.email)
  })

  it('refuses a name too short to be one', async () => {
    const user = userEvent.setup()
    render(<Organization onBack={() => {}} onSignIn={() => {}} />)

    await user.type(await screen.findByLabelText('Organisation name'), 'A')
    expect(screen.getByRole('button', { name: 'Create organisation' })).toBeDisabled()
  })
})

describe('the roster', () => {
  it('shows the seat count and the people in it', async () => {
    const { organization } = await seedOrg(3)
    await queries.inviteMember(organization.id, 'ada@example.com')

    render(<Organization onBack={() => {}} onSignIn={() => {}} />)

    expect(await screen.findByText(/2 of 3 seats used/)).toBeInTheDocument()
    expect(screen.getByText('ada@example.com')).toBeInTheDocument()
    expect(screen.getByText(/\(you\)/)).toBeInTheDocument()
  })

  it('invites someone and shows them as pending', async () => {
    const user = userEvent.setup()
    await seedOrg()
    render(<Organization onBack={() => {}} onSignIn={() => {}} />)

    await user.type(await screen.findByLabelText('Email address'), 'ada@example.com')
    await user.click(screen.getByRole('button', { name: 'Invite' }))

    expect(await screen.findByText(/Invited ada@example.com/)).toBeInTheDocument()
    expect(await screen.findByText('Invited')).toBeInTheDocument()
  })

  it('refuses a second invitation to the same address', async () => {
    const user = userEvent.setup()
    const { organization } = await seedOrg()
    await queries.inviteMember(organization.id, 'ada@example.com')

    render(<Organization onBack={() => {}} onSignIn={() => {}} />)
    await user.type(await screen.findByLabelText('Email address'), 'Ada@Example.com')

    expect(await screen.findByText(/already been invited/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Invite' })).toBeDisabled()
  })

  it('stops inviting when the seats run out, and says why', async () => {
    await seedOrg(1)
    render(<Organization onBack={() => {}} onSignIn={() => {}} />)

    expect(await screen.findByText(/All 1 seat is taken/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Email address')).toBeDisabled()
  })
})

describe('what an owner may do to themselves', () => {
  it('will not let the only owner leave', async () => {
    const user = userEvent.setup()
    await seedOrg()
    render(<Organization onBack={() => {}} onSignIn={() => {}} />)

    await user.click(await screen.findByRole('button', { name: /Manage owner@example.com/ }))
    const leave = await screen.findByRole('menuitem', { name: /Leave organisation/ })

    expect(leave).toBeDisabled()
    expect(leave).toHaveAccessibleName(/only owner/i)
  })

  it('will not let the only owner demote themselves', async () => {
    const user = userEvent.setup()
    await seedOrg()
    render(<Organization onBack={() => {}} onSignIn={() => {}} />)

    await user.click(await screen.findByRole('button', { name: /Manage owner@example.com/ }))
    expect(await screen.findByRole('menuitem', { name: /Make admin/ })).toBeDisabled()
  })
})

describe('a plain member', () => {
  it('sees the roster but is offered no way to change it', async () => {
    const { organization } = await seedOrg()
    const invited = await queries.inviteMember(organization.id, 'ada@example.com')
    await queries.claimMembership(organization.id, 'ada@example.com', 'user-ada')
    signIn('user-ada', 'ada@example.com')

    render(<Organization onBack={() => {}} onSignIn={() => {}} />)

    expect(await screen.findByText('owner@example.com')).toBeInTheDocument()
    // No invite panel at all — it is not disabled, it is absent.
    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument()

    const row = screen.getByText('owner@example.com').closest('li')!
    await userEvent.setup().click(
      within(row).getByRole('button', { name: /Manage owner@example.com/ }),
    )
    expect(await screen.findByRole('menuitem', { name: /Remove/ })).toBeDisabled()
    expect(invited.role).toBe('member')
  })

  it('cannot see the plan controls', async () => {
    const { organization } = await seedOrg()
    await queries.inviteMember(organization.id, 'ada@example.com')
    await queries.claimMembership(organization.id, 'ada@example.com', 'user-ada')
    signIn('user-ada', 'ada@example.com')

    render(<Organization onBack={() => {}} onSignIn={() => {}} />)

    expect(await screen.findByText('Only the owner can change the plan.')).toBeInTheDocument()
    expect(screen.queryByLabelText('One seat more')).not.toBeInTheDocument()
  })
})

describe('plugin access', () => {
  it('narrows the menu to what an admin allowed', async () => {
    const { organization } = await seedOrg()
    const invited = await queries.inviteMember(organization.id, 'ada@example.com')
    await queries.claimMembership(organization.id, 'ada@example.com', 'user-ada')
    await queries.updateMembership(invited.id, { allowedPluginIds: ['agenda'] })
    signIn('user-ada', 'ada@example.com')

    render(<PluginBar onOpen={() => {}} onOpenTheme={() => {}} aiConfigured={false} />)

    expect(await screen.findByText('Agenda')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText('Task Manager')).not.toBeInTheDocument()
    })
  })

  it('leaves a personal install with no organisation untouched', async () => {
    render(<PluginBar onOpen={() => {}} onOpenTheme={() => {}} aiConfigured={false} />)

    for (const plugin of registry) {
      expect(await screen.findByText(plugin.manifest.name)).toBeInTheDocument()
    }
  })

  it('shows a suspended member nothing at all', async () => {
    const { organization } = await seedOrg()
    const invited = await queries.inviteMember(organization.id, 'ada@example.com')
    await queries.claimMembership(organization.id, 'ada@example.com', 'user-ada')
    await queries.updateMembership(invited.id, { status: 'suspended' })
    signIn('user-ada', 'ada@example.com')

    render(<PluginBar onOpen={() => {}} onOpenTheme={() => {}} aiConfigured={false} />)

    expect(await screen.findByText('No plugins')).toBeInTheDocument()
  })
})
