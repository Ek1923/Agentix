import { motion } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { features } from '../core/features'
import { Button } from '../ui/components/Button'
import { transition } from '../ui/tokens'
import { Account } from './settings/Account'
import { ApiKeys } from './settings/ApiKeys'
import { Connection } from './settings/Connection'
import { DataSettings } from './settings/DataSettings'
import { OrganizationCard } from './settings/OrganizationCard'
import { PluginSettings } from './settings/PluginSettings'
import { Preferences } from './settings/Preferences'
import { Privacy } from './settings/Privacy'

interface SettingsProps {
  onBack: () => void
  onOpenOrganization: () => void
  onSignIn: () => void
}

/**
 * A labelled group of cards.
 *
 * Settings had grown to five cards in an unbroken stack, which reads as a wall
 * rather than a set of choices. Three headings turn it into something you can
 * scan for the thing you came for.
 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="px-1 eyebrow">
        {title}
      </h2>
      {children}
    </section>
  )
}

// Name and avatar are edited on the Profile screen, reached by tapping the profile
// bar. Two places to change one name is one place too many.
export function Settings({ onBack, onOpenOrganization, onSignIn }: SettingsProps) {
  return (
    <motion.main
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={transition.screen}
      className="mx-auto w-full max-w-4xl px-6 py-8"
    >
      <header className="flex items-center gap-4">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden />
          Back
        </Button>
        <h1 className="display text-lg text-ink">Settings</h1>
      </header>

      {/*
        Ordered by how often it is opened, not by how the system is built. Someone
        comes here to change how the app behaves far more often than to read the
        privacy statement, and the irreversible things sit last.
      */}
      <div className="mt-8 flex flex-col gap-10">
        <Section title="Preferences">
          <Preferences />
        </Section>

        <Section title="Plugins">
          <PluginSettings />
        </Section>

        {/*
          Account, sync and organisation all need a server to sign in to. Until
          the identity server exists they are hidden rather than shown broken — see
          core/features.ts. Everything below works with no account, so it stays.
        */}
        {features.accounts && (
          <>
            <Section title="Account">
              <Account onSignIn={onSignIn} />
              <Connection />
            </Section>

            <Section title="Organisation">
              <OrganizationCard onOpen={onOpenOrganization} />
            </Section>
          </>
        )}

        <Section title="AI">
          <ApiKeys />
        </Section>

        <Section title="Your data">
          <DataSettings />
        </Section>

        <Section title="Privacy">
          <Privacy />
        </Section>
      </div>
    </motion.main>
  )
}
