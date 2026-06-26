import type { Command } from 'commander';
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { theme } from '../ui/theme.js';

type ShellType = 'zsh' | 'bash' | 'fish';

function detectShell(): ShellType | null {
  const shell = process.env.SHELL ?? '';
  if (shell.includes('zsh')) return 'zsh';
  if (shell.includes('bash')) return 'bash';
  if (shell.includes('fish')) return 'fish';
  return null;
}

function getShellRcPath(shell: ShellType): string {
  switch (shell) {
    case 'zsh':
      return join(homedir(), '.zshrc');
    case 'bash':
      return join(homedir(), '.bashrc');
    case 'fish':
      return join(homedir(), '.config', 'fish', 'config.fish');
  }
}

function getSourceCommand(shell: ShellType): string {
  switch (shell) {
    case 'zsh':
      return 'source ~/.zshrc';
    case 'bash':
      return 'source ~/.bashrc';
    case 'fish':
      return 'source ~/.config/fish/config.fish';
  }
}

function getCompletionLine(shell: ShellType): string {
  switch (shell) {
    case 'zsh':
      return '\n# QwenCloud CLI completion\neval "$(qwencloud completion generate --shell zsh)"\n';
    case 'bash':
      return '\n# QwenCloud CLI completion\neval "$(qwencloud completion generate --shell bash)"\n';
    case 'fish':
      return '\n# QwenCloud CLI completion\nqwencloud completion generate --shell fish | source\n';
  }
}

function generateZshCompletion(): string {
  // The script is meant to be eval'd from .zshrc, not placed in $fpath, so the
  // `#compdef` magic comment is dropped. Before calling `compdef` we ensure
  // compinit has run — otherwise zsh emits
  // `compdef:153: _comps: assignment to invalid subscript range` on every
  // command and the noise pollutes Agent stderr parsing.
  return `# QwenCloud CLI zsh completion (generated)
if ! whence compdef >/dev/null 2>&1; then
  autoload -Uz compinit
  compinit -i
fi

_qwencloud() {
  local cur="\${words[-1]}" prev="\${words[-2]}"

  # ── Option value completions (global, position-independent) ──────────────
  case "$prev" in
    --format)      compadd table json text; return ;;
    --granularity) compadd day month; return ;;
    --period)      compadd today yesterday week month last-month quarter year; return ;;
    --shell)       compadd bash zsh fish; return ;;
    --input|--output) compadd text image audio video; return ;;
    --charge-type) compadd all postpaid prepaid; return ;;
    --group-by)    compadd model api-key; return ;;
  esac

  # ── Top-level dispatch ────────────────────────────────────────────────────
  local -a top_commands
  top_commands=(
    'auth:Manage authentication'
    'billing:Inspect billing limits, breakdown, and summaries'
    'completion:Install shell tab completion'
    'config:Manage CLI configuration'
    'docs:Search documentation'
    'doctor:Run diagnostics'
    'models:Browse and search models'
    'subscription:Manage subscriptions and token plans'
    'support:Manage support tickets'
    'usage:View usage and billing'
    'version:Show CLI version'
    'workspace:Manage workspaces'
    'update:Update CLI to the latest version'
  )

  if (( CURRENT == 2 )); then
    _describe -t commands 'qwencloud command' top_commands
    _arguments '(-h --help)'{-h,--help}'[Show help]'
    return
  fi

  # ── Subcommand dispatch ───────────────────────────────────────────────────
  local cmd="\${words[2]}"

  case "$cmd" in
    auth)
      if (( CURRENT == 3 )); then
        local -a subs
        subs=('login:Login via Device Flow' 'logout:Remove credentials' 'status:Auth status')
        _describe -t commands 'auth subcommand' subs
        _arguments '(-h --help)'{-h,--help}'[Show help]'
      else
        case "\${words[3]}" in
          login)
            _arguments \\
              '--format[Output format]:format:(table json text)' \\
              '--init-only[Output device code and exit]' \\
              '--complete[Resume pending login session]' \\
              '--timeout[Polling timeout seconds]:n:()' \\
              '(-h --help)'{-h,--help}'[Show help]'
            ;;
          logout|status)
            _arguments \\
              '--format[Output format]:format:(table json text)' \\
              '(-h --help)'{-h,--help}'[Show help]'
            ;;
        esac
      fi
      ;;

    models)
      if (( CURRENT == 3 )); then
        local -a subs
        subs=('list:List models' 'info:Model details' 'search:Search models')
        _describe -t commands 'models subcommand' subs
      else
        case "\${words[3]}" in
          list)
            _arguments \\
              '--input[Input modality]:modality:(text image audio video)' \\
              '--output[Output modality]:modality:(text image audio video)' \\
              '--all[Show all models]' \\
              '--free-tier[Free tier models only]' \\
              '--page[Page number]:n:()' \\
              '--per-page[Models per page]:n:()' \\
              '--verbose[Include extended details]' \\
              '--format[Output format]:format:(table json text)' \\
              '(-h --help)'{-h,--help}'[Show help]'
            ;;
          info)
            _arguments \\
              '--model[Model ID]:model:()' \\
              '1:model:()' \\
              '--format[Output format]:format:(table json text)' \\
              '(-h --help)'{-h,--help}'[Show help]'
            ;;
          search)
            _arguments \\
              '1:query:()' \\
              '--page[Page number]:n:()' \\
              '--per-page[Models per page]:n:()' \\
              '--all[Return all results]' \\
              '--format[Output format]:format:(table json text)' \\
              '(-h --help)'{-h,--help}'[Show help]'
            ;;
        esac
      fi
      ;;

    billing)
      if (( CURRENT == 3 )); then
        local -a subs
        subs=('limit:View billing limit' 'breakdown:Cost breakdown' 'summary:Billing summary')
        _describe -t commands 'billing subcommand' subs
      else
        case "\${words[3]}" in
          limit)
            _arguments '--format[Output format]:format:(table json text)' '(-h --help)'{-h,--help}'[Show help]'
            ;;
          breakdown)
            _arguments \\
              '--group-by[Group by]:group:(model api-key)' \\
              '--granularity[Granularity]:granularity:(day month)' \\
              '--from[Start date]:date:()' \\
              '--to[End date]:date:()' \\
              '--period[Period preset]:period:(today yesterday week month last-month quarter year)' \\
              '--charge-type[Charge type]:type:(all postpaid prepaid)' \\
              '--top[Top N]:n:()' \\
              '--format[Output format]:format:(table json text)' \\
              '(-h --help)'{-h,--help}'[Show help]'
            ;;
          summary)
            _arguments \\
              '--from[Start date]:date:()' \\
              '--to[End date]:date:()' \\
              '--charge-type[Charge type]:type:(all postpaid prepaid)' \\
              '--format[Output format]:format:(table json text)' \\
              '(-h --help)'{-h,--help}'[Show help]'
            ;;
        esac
      fi
      ;;

    docs)
      if (( CURRENT == 3 )); then
        local -a subs
        subs=('search:Search documentation' 'view:View a docs page')
        _describe -t commands 'docs subcommand' subs
      else
        case "\${words[3]}" in
          search)
            _arguments \\
              '--limit[Result limit]:n:()' \\
              '--page[Page number]:n:()' \\
              '--language[Language]:lang:(en zh)' \\
              '--view[View result by index]:n:()' \\
              '--format[Output format]:format:(table json text)' \\
              '(-h --help)'{-h,--help}'[Show help]'
            ;;
          view)
            _arguments \\
              '1:path:_files' \\
              '--format[Output format]:format:(table json text)' \\
              '(-h --help)'{-h,--help}'[Show help]'
            ;;
        esac
      fi
      ;;

    subscription)
      if (( CURRENT == 3 )); then
        local -a subs
        subs=('status:Subscription status' 'orders:Subscription orders' 'tokenplan:Token plan management')
        _describe -t commands 'subscription subcommand' subs
      else
        case "\${words[3]}" in
          status)
            _arguments \\
              '--plan[Plan type]:plan:(token coding)' \\
              '--format[Output format]:format:(table json text)' \\
              '(-h --help)'{-h,--help}'[Show help]'
            ;;
          orders)
            _arguments \\
              '--from[Start date]:date:()' \\
              '--to[End date]:date:()' \\
              '--type[Order type]:type:(purchase renew upgrade)' \\
              '--page[Page number]:n:()' \\
              '--page-size[Page size]:n:()' \\
              '--format[Output format]:format:(table json text)' \\
              '(-h --help)'{-h,--help}'[Show help]'
            ;;
          tokenplan)
            if (( CURRENT == 4 )); then
              local -a tpsubs
              tpsubs=('status:Token plan status' 'seats:Token plan seats')
              _describe -t commands 'tokenplan subcommand' tpsubs
            else
              case "\${words[4]}" in
                status)
                  _arguments '--format[Output format]:format:(table json text)' '(-h --help)'{-h,--help}'[Show help]'
                  ;;
                seats)
                  _arguments \\
                    '--spec-type[Spec type]:type:(pro standard)' \\
                    '--page[Page number]:n:()' \\
                    '--page-size[Page size]:n:()' \\
                    '--format[Output format]:format:(table json text)' \\
                    '(-h --help)'{-h,--help}'[Show help]'
                  ;;
              esac
            fi
            ;;
        esac
      fi
      ;;

    support)
      if (( CURRENT == 3 )); then
        local -a subs
        subs=('list:List tickets' 'view:View ticket' 'create:Create ticket' 'close:Close ticket' 'reply:Reply to ticket' 'rate:Rate ticket')
        _describe -t commands 'support subcommand' subs
      else
        case "\${words[3]}" in
          list)
            _arguments \\
              '--page[Page number]:n:()' \\
              '--page-size[Page size]:n:()' \\
              '--format[Output format]:format:(table json text)' \\
              '(-h --help)'{-h,--help}'[Show help]'
            ;;
          view|create)
            _arguments '--format[Output format]:format:(table json text)' '(-h --help)'{-h,--help}'[Show help]'
            ;;
          close)
            _arguments '--yes[Skip confirmation]' '--format[Output format]:format:(table json text)' '(-h --help)'{-h,--help}'[Show help]'
            ;;
          reply)
            _arguments '--message[Reply message]:msg:()' '--format[Output format]:format:(table json text)' '(-h --help)'{-h,--help}'[Show help]'
            ;;
          rate)
            _arguments '--rating[Rating]:rating:()' '--comment[Comment]:comment:()' '--format[Output format]:format:(table json text)' '(-h --help)'{-h,--help}'[Show help]'
            ;;
        esac
      fi
      ;;

    workspace)
      if (( CURRENT == 3 )); then
        local -a subs
        subs=('list:List workspaces' 'limit:View workspace limits')
        _describe -t commands 'workspace subcommand' subs
      else
        _arguments '--format[Output format]:format:(table json text)' '(-h --help)'{-h,--help}'[Show help]'
      fi
      ;;

    usage)
      if (( CURRENT == 3 )); then
        local -a subs
        subs=(
          'summary:Usage summary across all models'
          'breakdown:Per-model breakdown by date'
          'free-tier:Free tier quota status'
          'payg:Pay-as-you-go usage'
          'logs:View usage logs'
        )
        _describe -t commands 'usage subcommand' subs
      else
        local -a date_opts
        date_opts=(
          '--from[Start date (YYYY-MM-DD)]:date:()'
          '--to[End date (YYYY-MM-DD)]:date:()'
          '--period[Period preset]:period:(today yesterday week month last-month quarter year)'
          '--format[Output format]:format:(table json text)'
        )
        local help_opt='(-h --help)'{-h,--help}'[Show help]'
        case "\${words[3]}" in
          summary|free-tier)
            _arguments $date_opts $help_opt
            ;;
          payg)
            _arguments $date_opts '--days[Days to look back]:n:()' $help_opt
            ;;
          breakdown)
            _arguments \\
              '--model[Model ID (required)]:model:()' \\
              '--granularity[Time granularity]:granularity:(day month quarter)' \\
              '--from[Start date]:date:()' \\
              '--to[End date]:date:()' \\
              '--period[Period preset]:period:(today yesterday week month last-month quarter year)' \\
              '--days[Days to look back]:n:()' \\
              '--format[Output format]:format:(table json text)' \\
              '(-h --help)'{-h,--help}'[Show help]'
            ;;
          logs)
            _arguments \\
              '--from[Start date]:date:()' \\
              '--to[End date]:date:()' \\
              '--period[Period preset]:period:(today yesterday week month last-month quarter year)' \\
              '--model[Model ID]:model:()' \\
              '--status[Status filter]:status:(0 2xx 4xx 5xx)' \\
              '--request-id[Request ID]:id:()' \\
              '--page[Page number]:n:()' \\
              '--page-size[Page size]:n:()' \\
              '--format[Output format]:format:(table json text)' \\
              '(-h --help)'{-h,--help}'[Show help]'
            ;;
        esac
      fi
      ;;

    config)
      if (( CURRENT == 3 )); then
        local -a subs
        subs=('list:List all config' 'get:Get a value' 'set:Set a value' 'unset:Remove a value')
        _describe -t commands 'config subcommand' subs
      else
        case "\${words[3]}" in
          list) _arguments '--format[Output format]:format:(table json text)' '(-h --help)'{-h,--help}'[Show help]' ;;
          get|unset) _arguments '1:key:()' '--format[Output format]:format:(table json text)' '(-h --help)'{-h,--help}'[Show help]' ;;
          set) _arguments '1:key:()' '1:value:()' '--format[Output format]:format:(table json text)' '(-h --help)'{-h,--help}'[Show help]' ;;
        esac
      fi
      ;;

    completion)
      if (( CURRENT == 3 )); then
        local -a subs
        subs=('install:Install tab completion' 'generate:Print completion script')
        _describe -t commands 'completion subcommand' subs
      else
        _arguments '--shell[Shell type]:shell:(bash zsh fish)' '(-h --help)'{-h,--help}'[Show help]'
      fi
      ;;

    update)
      _arguments '(-h --help)'{-h,--help}'[Show help]'
      ;;

    doctor)
      _arguments \\
        '--format[Output format]:format:(table json text)' \\
        '(-h --help)'{-h,--help}'[Show help]'
      ;;

    version)
      _arguments \\
        '--check[Check for updates]' \\
        '(-h --help)'{-h,--help}'[Show help]'
      ;;
  esac
}

compdef _qwencloud qwencloud
`;
}

function generateBashCompletion(): string {
  return `_qwencloud() {
  local cur prev cmd sub
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  cmd="\${COMP_WORDS[1]}"
  sub="\${COMP_WORDS[2]}"

  # ── Option value completions ──────────────────────────────────────────────
  case "$prev" in
    --format)
      COMPREPLY=( $(compgen -W "table json text" -- "$cur") ); return 0 ;;
    --granularity)
      COMPREPLY=( $(compgen -W "day month" -- "$cur") ); return 0 ;;
    --period)
      COMPREPLY=( $(compgen -W "today yesterday week month last-month quarter year" -- "$cur") ); return 0 ;;
    --shell)
      COMPREPLY=( $(compgen -W "bash zsh fish" -- "$cur") ); return 0 ;;
    --input|--output)
      COMPREPLY=( $(compgen -W "text image audio video" -- "$cur") ); return 0 ;;
    --charge-type)
      COMPREPLY=( $(compgen -W "all postpaid prepaid" -- "$cur") ); return 0 ;;
    --group-by)
      COMPREPLY=( $(compgen -W "model api-key" -- "$cur") ); return 0 ;;
  esac

  # ── Subcommand option completions ─────────────────────────────────────────
  if [ "$COMP_CWORD" -ge 3 ]; then
    case "$cmd" in
      billing)
        case "$sub" in
          limit)     COMPREPLY=( $(compgen -W "--format -h --help" -- "$cur") ); return 0 ;;
          breakdown) COMPREPLY=( $(compgen -W "--group-by --granularity --from --to --period --charge-type --top --format -h --help" -- "$cur") ); return 0 ;;
          summary)   COMPREPLY=( $(compgen -W "--from --to --charge-type --format -h --help" -- "$cur") ); return 0 ;;
        esac ;;
      docs)
        case "$sub" in
          search) COMPREPLY=( $(compgen -W "--limit --page --language --view --format -h --help" -- "$cur") ); return 0 ;;
          view)   COMPREPLY=( $(compgen -W "--format -h --help" -- "$cur") ); return 0 ;;
        esac ;;
      models)
        case "$sub" in
          list)   COMPREPLY=( $(compgen -W "--input --output --all --free-tier --page --per-page --verbose --format -h --help" -- "$cur") ); return 0 ;;
          info)   COMPREPLY=( $(compgen -W "--model --format -h --help" -- "$cur") ); return 0 ;;
          search) COMPREPLY=( $(compgen -W "--page --per-page --all --format -h --help" -- "$cur") ); return 0 ;;
        esac ;;
      subscription)
        local sub3="\${COMP_WORDS[3]}"
        case "$sub" in
          status)    COMPREPLY=( $(compgen -W "--plan --format -h --help" -- "$cur") ); return 0 ;;
          orders)    COMPREPLY=( $(compgen -W "--from --to --type --page --page-size --format -h --help" -- "$cur") ); return 0 ;;
          tokenplan)
            case "$sub3" in
              status) COMPREPLY=( $(compgen -W "--format -h --help" -- "$cur") ); return 0 ;;
              seats)  COMPREPLY=( $(compgen -W "--spec-type --page --page-size --format -h --help" -- "$cur") ); return 0 ;;
              *)      COMPREPLY=( $(compgen -W "status seats -h --help" -- "$cur") ); return 0 ;;
            esac ;;
        esac ;;
      support)
        case "$sub" in
          list)    COMPREPLY=( $(compgen -W "--page --page-size --format -h --help" -- "$cur") ); return 0 ;;
          view|create) COMPREPLY=( $(compgen -W "--format -h --help" -- "$cur") ); return 0 ;;
          close) COMPREPLY=( $(compgen -W "--yes --format -h --help" -- "$cur") ); return 0 ;;
          reply)   COMPREPLY=( $(compgen -W "--message --format -h --help" -- "$cur") ); return 0 ;;
          rate)    COMPREPLY=( $(compgen -W "--rating --comment --format -h --help" -- "$cur") ); return 0 ;;
        esac ;;
      usage)
        local date_opts="--from --to --period --format"
        case "$sub" in
          summary|free-tier) COMPREPLY=( $(compgen -W "$date_opts -h --help" -- "$cur") ); return 0 ;;
          payg)              COMPREPLY=( $(compgen -W "$date_opts --days -h --help" -- "$cur") ); return 0 ;;
          breakdown)         COMPREPLY=( $(compgen -W "--model --granularity $date_opts --days -h --help" -- "$cur") ); return 0 ;;
          logs)              COMPREPLY=( $(compgen -W "--from --to --period --model --status --request-id --page --page-size --format -h --help" -- "$cur") ); return 0 ;;
        esac ;;
      config)
        case "$sub" in
          list)        COMPREPLY=( $(compgen -W "--format -h --help" -- "$cur") ); return 0 ;;
          get|unset)   COMPREPLY=( $(compgen -W "--format -h --help" -- "$cur") ); return 0 ;;
          set)         COMPREPLY=( $(compgen -W "--format -h --help" -- "$cur") ); return 0 ;;
        esac ;;
      completion)
        COMPREPLY=( $(compgen -W "--shell -h --help" -- "$cur") ); return 0 ;;
      auth)
        case "$sub" in
          login)  COMPREPLY=( $(compgen -W "--format --init-only --complete --timeout -h --help" -- "$cur") ); return 0 ;;
          logout|status) COMPREPLY=( $(compgen -W "--format -h --help" -- "$cur") ); return 0 ;;
        esac ;;
      doctor)
        COMPREPLY=( $(compgen -W "--format -h --help" -- "$cur") ); return 0 ;;
      version)
        COMPREPLY=( $(compgen -W "--check -h --help" -- "$cur") ); return 0 ;;
      workspace)
        COMPREPLY=( $(compgen -W "--format -h --help" -- "$cur") ); return 0 ;;
      update)
        COMPREPLY=( $(compgen -W "-h --help" -- "$cur") ); return 0 ;;
    esac
  fi

  # ── Subcommand completions ────────────────────────────────────────────────
  if [ "$COMP_CWORD" -eq 2 ]; then
    case "$cmd" in
      auth)         COMPREPLY=( $(compgen -W "login logout status" -- "$cur") ); return 0 ;;
      billing)      COMPREPLY=( $(compgen -W "limit breakdown summary" -- "$cur") ); return 0 ;;
      completion)   COMPREPLY=( $(compgen -W "install generate" -- "$cur") ); return 0 ;;
      config)       COMPREPLY=( $(compgen -W "list get set unset" -- "$cur") ); return 0 ;;
      docs)         COMPREPLY=( $(compgen -W "search view" -- "$cur") ); return 0 ;;
      models)       COMPREPLY=( $(compgen -W "list info search" -- "$cur") ); return 0 ;;
      subscription) COMPREPLY=( $(compgen -W "status orders tokenplan" -- "$cur") ); return 0 ;;
      support)      COMPREPLY=( $(compgen -W "list view create close reply rate" -- "$cur") ); return 0 ;;
      usage)        COMPREPLY=( $(compgen -W "summary breakdown free-tier payg logs" -- "$cur") ); return 0 ;;
      workspace)    COMPREPLY=( $(compgen -W "list limit" -- "$cur") ); return 0 ;;
    esac
  fi

  # ── Top-level command completions ─────────────────────────────────────────
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "auth billing completion config docs doctor models subscription support usage version workspace update -h --help" -- "$cur") )
  fi
}

complete -F _qwencloud qwencloud
`;
}

function generateFishCompletion(): string {
  return `# QwenCloud CLI completions for fish

# ── Helpers ───────────────────────────────────────────────────────────────────
function __qwencloud_seen_cmd
  set -l cmd (commandline -opc)
  contains -- $argv[1] $cmd
end

function __qwencloud_seen_sub
  set -l cmd (commandline -opc)
  contains -- $argv[1] $cmd and contains -- $argv[2] $cmd
end

# ── Top-level commands ────────────────────────────────────────────────────────
complete -c qwencloud -n 'not __fish_seen_subcommand_from auth billing completion config docs doctor models subscription support usage version workspace update' -f
complete -c qwencloud -n 'not __fish_seen_subcommand_from auth billing completion config docs doctor models subscription support usage version workspace update' -a auth         -d 'Manage authentication'
complete -c qwencloud -n 'not __fish_seen_subcommand_from auth billing completion config docs doctor models subscription support usage version workspace update' -a billing      -d 'Inspect billing limits, breakdown, and summaries'
complete -c qwencloud -n 'not __fish_seen_subcommand_from auth billing completion config docs doctor models subscription support usage version workspace update' -a completion   -d 'Install shell tab completion'
complete -c qwencloud -n 'not __fish_seen_subcommand_from auth billing completion config docs doctor models subscription support usage version workspace update' -a config       -d 'Manage CLI configuration'
complete -c qwencloud -n 'not __fish_seen_subcommand_from auth billing completion config docs doctor models subscription support usage version workspace update' -a docs         -d 'Search documentation'
complete -c qwencloud -n 'not __fish_seen_subcommand_from auth billing completion config docs doctor models subscription support usage version workspace update' -a doctor       -d 'Run diagnostics'
complete -c qwencloud -n 'not __fish_seen_subcommand_from auth billing completion config docs doctor models subscription support usage version workspace update' -a models       -d 'Browse and search models'
complete -c qwencloud -n 'not __fish_seen_subcommand_from auth billing completion config docs doctor models subscription support usage version workspace update' -a subscription -d 'Manage subscriptions'
complete -c qwencloud -n 'not __fish_seen_subcommand_from auth billing completion config docs doctor models subscription support usage version workspace update' -a support      -d 'Manage support tickets'
complete -c qwencloud -n 'not __fish_seen_subcommand_from auth billing completion config docs doctor models subscription support usage version workspace update' -a usage        -d 'View usage and billing'
complete -c qwencloud -n 'not __fish_seen_subcommand_from auth billing completion config docs doctor models subscription support usage version workspace update' -a version      -d 'Show CLI version'
complete -c qwencloud -n 'not __fish_seen_subcommand_from auth billing completion config docs doctor models subscription support usage version workspace update' -a workspace    -d 'Manage workspaces'
complete -c qwencloud -n 'not __fish_seen_subcommand_from auth billing completion config docs doctor models subscription support usage version workspace update' -a update       -d 'Update CLI'

# ── billing subcommands ──────────────────────────────────────────────────
complete -c qwencloud -n '__fish_seen_subcommand_from billing; and not __fish_seen_subcommand_from limit breakdown summary' -f
complete -c qwencloud -n '__fish_seen_subcommand_from billing; and not __fish_seen_subcommand_from limit breakdown summary' -a limit     -d 'View billing limit'
complete -c qwencloud -n '__fish_seen_subcommand_from billing; and not __fish_seen_subcommand_from limit breakdown summary' -a breakdown -d 'Cost breakdown'
complete -c qwencloud -n '__fish_seen_subcommand_from billing; and not __fish_seen_subcommand_from limit breakdown summary' -a summary   -d 'Billing summary'
complete -c qwencloud -n '__fish_seen_subcommand_from billing; and __fish_seen_subcommand_from limit' -l format -d 'Output format' -a 'table json text'
complete -c qwencloud -n '__fish_seen_subcommand_from billing; and __fish_seen_subcommand_from breakdown' -l group-by     -d 'Group by' -a 'model api-key'
complete -c qwencloud -n '__fish_seen_subcommand_from billing; and __fish_seen_subcommand_from breakdown' -l granularity  -d 'Granularity' -a 'day month'
complete -c qwencloud -n '__fish_seen_subcommand_from billing; and __fish_seen_subcommand_from breakdown' -l from         -d 'Start date'
complete -c qwencloud -n '__fish_seen_subcommand_from billing; and __fish_seen_subcommand_from breakdown' -l to           -d 'End date'
complete -c qwencloud -n '__fish_seen_subcommand_from billing; and __fish_seen_subcommand_from breakdown' -l period       -d 'Period preset' -a 'today yesterday week month last-month quarter year'
complete -c qwencloud -n '__fish_seen_subcommand_from billing; and __fish_seen_subcommand_from breakdown' -l charge-type  -d 'Charge type' -a 'all postpaid prepaid'
complete -c qwencloud -n '__fish_seen_subcommand_from billing; and __fish_seen_subcommand_from breakdown' -l top          -d 'Top N'
complete -c qwencloud -n '__fish_seen_subcommand_from billing; and __fish_seen_subcommand_from breakdown' -l format       -d 'Output format' -a 'table json text'
complete -c qwencloud -n '__fish_seen_subcommand_from billing; and __fish_seen_subcommand_from summary' -l from         -d 'Start date'
complete -c qwencloud -n '__fish_seen_subcommand_from billing; and __fish_seen_subcommand_from summary' -l to           -d 'End date'
complete -c qwencloud -n '__fish_seen_subcommand_from billing; and __fish_seen_subcommand_from summary' -l charge-type  -d 'Charge type' -a 'all postpaid prepaid'
complete -c qwencloud -n '__fish_seen_subcommand_from billing; and __fish_seen_subcommand_from summary' -l format       -d 'Output format' -a 'table json text'

# ── docs subcommands ─────────────────────────────────────────────────────
complete -c qwencloud -n '__fish_seen_subcommand_from docs; and not __fish_seen_subcommand_from search view' -f
complete -c qwencloud -n '__fish_seen_subcommand_from docs; and not __fish_seen_subcommand_from search view' -a search -d 'Search documentation'
complete -c qwencloud -n '__fish_seen_subcommand_from docs; and not __fish_seen_subcommand_from search view' -a view   -d 'View a docs page'
complete -c qwencloud -n '__fish_seen_subcommand_from docs; and __fish_seen_subcommand_from search' -l limit    -d 'Result limit'
complete -c qwencloud -n '__fish_seen_subcommand_from docs; and __fish_seen_subcommand_from search' -l page     -d 'Page number'
complete -c qwencloud -n '__fish_seen_subcommand_from docs; and __fish_seen_subcommand_from search' -l language -d 'Language' -a 'en zh'
complete -c qwencloud -n '__fish_seen_subcommand_from docs; and __fish_seen_subcommand_from search' -l view     -d 'View result by index'
complete -c qwencloud -n '__fish_seen_subcommand_from docs; and __fish_seen_subcommand_from search' -l format   -d 'Output format' -a 'table json text'

# ── auth subcommands ──────────────────────────────────────────────────────────
complete -c qwencloud -n '__fish_seen_subcommand_from auth; and not __fish_seen_subcommand_from login logout status' -f
complete -c qwencloud -n '__fish_seen_subcommand_from auth; and not __fish_seen_subcommand_from login logout status' -a login   -d 'Login via Device Flow'
complete -c qwencloud -n '__fish_seen_subcommand_from auth; and not __fish_seen_subcommand_from login logout status' -a logout  -d 'Remove credentials'
complete -c qwencloud -n '__fish_seen_subcommand_from auth; and not __fish_seen_subcommand_from login logout status' -a status  -d 'Auth status'

# ── models subcommands ────────────────────────────────────────────────────────
complete -c qwencloud -n '__fish_seen_subcommand_from models; and not __fish_seen_subcommand_from list info search' -f
complete -c qwencloud -n '__fish_seen_subcommand_from models; and not __fish_seen_subcommand_from list info search' -a list   -d 'List models'
complete -c qwencloud -n '__fish_seen_subcommand_from models; and not __fish_seen_subcommand_from list info search' -a info   -d 'Model details'
complete -c qwencloud -n '__fish_seen_subcommand_from models; and not __fish_seen_subcommand_from list info search' -a search -d 'Search models'

complete -c qwencloud -n '__fish_seen_subcommand_from list'   -l input      -d 'Input modality'   -a 'text image audio video'
complete -c qwencloud -n '__fish_seen_subcommand_from list'   -l output     -d 'Output modality'  -a 'text image audio video'
complete -c qwencloud -n '__fish_seen_subcommand_from list'   -l all        -d 'Show all models'
complete -c qwencloud -n '__fish_seen_subcommand_from list'   -l free-tier  -d 'Free tier only'
complete -c qwencloud -n '__fish_seen_subcommand_from list'   -l page      -d 'Page number'
complete -c qwencloud -n '__fish_seen_subcommand_from list'   -l per-page  -d 'Models per page'
complete -c qwencloud -n '__fish_seen_subcommand_from list'   -l verbose   -d 'Include extended details'
complete -c qwencloud -n '__fish_seen_subcommand_from info'    -l model    -d 'Model ID'
complete -c qwencloud -n '__fish_seen_subcommand_from info'    -l format   -d 'Output format' -a 'table json text'
complete -c qwencloud -n '__fish_seen_subcommand_from search' -l page      -d 'Page number'
complete -c qwencloud -n '__fish_seen_subcommand_from search' -l per-page  -d 'Models per page'
complete -c qwencloud -n '__fish_seen_subcommand_from search' -l all       -d 'Return all results'

# ── usage subcommands ─────────────────────────────────────────────────────────
complete -c qwencloud -n '__fish_seen_subcommand_from usage; and not __fish_seen_subcommand_from summary breakdown free-tier payg logs' -f
complete -c qwencloud -n '__fish_seen_subcommand_from usage; and not __fish_seen_subcommand_from summary breakdown free-tier payg logs' -a summary   -d 'Usage summary'
complete -c qwencloud -n '__fish_seen_subcommand_from usage; and not __fish_seen_subcommand_from summary breakdown free-tier payg logs' -a breakdown -d 'Per-model breakdown'
complete -c qwencloud -n '__fish_seen_subcommand_from usage; and not __fish_seen_subcommand_from summary breakdown free-tier payg logs' -a free-tier -d 'Free tier quota'
complete -c qwencloud -n '__fish_seen_subcommand_from usage; and not __fish_seen_subcommand_from summary breakdown free-tier payg logs' -a payg      -d 'Pay-as-you-go usage'
complete -c qwencloud -n '__fish_seen_subcommand_from usage; and not __fish_seen_subcommand_from summary breakdown free-tier payg logs' -a logs      -d 'View usage logs'

complete -c qwencloud -n '__fish_seen_subcommand_from summary free-tier payg breakdown logs' -l from   -d 'Start date (YYYY-MM-DD)'
complete -c qwencloud -n '__fish_seen_subcommand_from summary free-tier payg breakdown logs' -l to     -d 'End date (YYYY-MM-DD)'
complete -c qwencloud -n '__fish_seen_subcommand_from summary free-tier payg breakdown logs' -l period -d 'Period preset' -a 'today yesterday week month last-month quarter year'
complete -c qwencloud -n '__fish_seen_subcommand_from payg breakdown'                       -l days   -d 'Days to look back'
complete -c qwencloud -n '__fish_seen_subcommand_from breakdown'                            -l model       -d 'Model ID (required)'
complete -c qwencloud -n '__fish_seen_subcommand_from breakdown'                            -l granularity -d 'Time granularity' -a 'day month quarter'
complete -c qwencloud -n '__fish_seen_subcommand_from logs'                                 -l model      -d 'Model ID'
complete -c qwencloud -n '__fish_seen_subcommand_from logs'                                 -l status     -d 'Status filter' -a '0 2xx 4xx 5xx'
complete -c qwencloud -n '__fish_seen_subcommand_from logs'                                 -l request-id -d 'Request ID'
complete -c qwencloud -n '__fish_seen_subcommand_from logs'                                 -l page       -d 'Page number'
complete -c qwencloud -n '__fish_seen_subcommand_from logs'                                 -l page-size  -d 'Page size'

# ── config subcommands ────────────────────────────────────────────────────────
complete -c qwencloud -n '__fish_seen_subcommand_from config; and not __fish_seen_subcommand_from list get set unset' -f
complete -c qwencloud -n '__fish_seen_subcommand_from config; and not __fish_seen_subcommand_from list get set unset' -a list  -d 'List config'
complete -c qwencloud -n '__fish_seen_subcommand_from config; and not __fish_seen_subcommand_from list get set unset' -a get   -d 'Get a value'
complete -c qwencloud -n '__fish_seen_subcommand_from config; and not __fish_seen_subcommand_from list get set unset' -a set   -d 'Set a value'
complete -c qwencloud -n '__fish_seen_subcommand_from config; and not __fish_seen_subcommand_from list get set unset' -a unset -d 'Remove a value'
complete -c qwencloud -n '__fish_seen_subcommand_from config; and __fish_seen_subcommand_from list get set unset' -l format -d 'Output format' -a 'table json text'

# ── completion subcommands ────────────────────────────────────────────────────
complete -c qwencloud -n '__fish_seen_subcommand_from completion; and not __fish_seen_subcommand_from install generate' -f
complete -c qwencloud -n '__fish_seen_subcommand_from completion; and not __fish_seen_subcommand_from install generate' -a install  -d 'Install tab completion'
complete -c qwencloud -n '__fish_seen_subcommand_from completion; and not __fish_seen_subcommand_from install generate' -a generate -d 'Print completion script'
complete -c qwencloud -n '__fish_seen_subcommand_from install generate' -l shell -d 'Shell type' -a 'bash zsh fish'

# ── subscription subcommands ─────────────────────────────────────────────────
complete -c qwencloud -n '__fish_seen_subcommand_from subscription; and not __fish_seen_subcommand_from status orders tokenplan' -f
complete -c qwencloud -n '__fish_seen_subcommand_from subscription; and not __fish_seen_subcommand_from status orders tokenplan' -a status    -d 'Subscription status'
complete -c qwencloud -n '__fish_seen_subcommand_from subscription; and not __fish_seen_subcommand_from status orders tokenplan' -a orders    -d 'Subscription orders'
complete -c qwencloud -n '__fish_seen_subcommand_from subscription; and not __fish_seen_subcommand_from status orders tokenplan' -a tokenplan -d 'Token plan management'
complete -c qwencloud -n '__fish_seen_subcommand_from subscription; and __fish_seen_subcommand_from status' -l plan   -d 'Plan type' -a 'token coding'
complete -c qwencloud -n '__fish_seen_subcommand_from subscription; and __fish_seen_subcommand_from status' -l format -d 'Output format' -a 'table json text'
complete -c qwencloud -n '__fish_seen_subcommand_from subscription; and __fish_seen_subcommand_from orders' -l from          -d 'Start date'
complete -c qwencloud -n '__fish_seen_subcommand_from subscription; and __fish_seen_subcommand_from orders' -l to            -d 'End date'
complete -c qwencloud -n '__fish_seen_subcommand_from subscription; and __fish_seen_subcommand_from orders' -l type          -d 'Order type' -a 'purchase renew upgrade'
complete -c qwencloud -n '__fish_seen_subcommand_from subscription; and __fish_seen_subcommand_from orders' -l page          -d 'Page number'
complete -c qwencloud -n '__fish_seen_subcommand_from subscription; and __fish_seen_subcommand_from orders' -l page-size     -d 'Page size'
complete -c qwencloud -n '__fish_seen_subcommand_from subscription; and __fish_seen_subcommand_from orders' -l format        -d 'Output format' -a 'table json text'
complete -c qwencloud -n '__fish_seen_subcommand_from subscription; and __fish_seen_subcommand_from tokenplan' -a 'status seats'
complete -c qwencloud -n '__fish_seen_subcommand_from subscription; and __fish_seen_subcommand_from tokenplan; and __fish_seen_subcommand_from status' -l format    -d 'Output format' -a 'table json text'
complete -c qwencloud -n '__fish_seen_subcommand_from subscription; and __fish_seen_subcommand_from tokenplan; and __fish_seen_subcommand_from seats' -l spec-type -d 'Spec type' -a 'pro standard'
complete -c qwencloud -n '__fish_seen_subcommand_from subscription; and __fish_seen_subcommand_from tokenplan; and __fish_seen_subcommand_from seats' -l page      -d 'Page number'
complete -c qwencloud -n '__fish_seen_subcommand_from subscription; and __fish_seen_subcommand_from tokenplan; and __fish_seen_subcommand_from seats' -l page-size -d 'Page size'
complete -c qwencloud -n '__fish_seen_subcommand_from subscription; and __fish_seen_subcommand_from tokenplan; and __fish_seen_subcommand_from seats' -l format    -d 'Output format' -a 'table json text'

# ── support subcommands ──────────────────────────────────────────────────────
complete -c qwencloud -n '__fish_seen_subcommand_from support; and not __fish_seen_subcommand_from list view create close reply rate' -f
complete -c qwencloud -n '__fish_seen_subcommand_from support; and not __fish_seen_subcommand_from list view create close reply rate' -a list    -d 'List tickets'
complete -c qwencloud -n '__fish_seen_subcommand_from support; and not __fish_seen_subcommand_from list view create close reply rate' -a view    -d 'View ticket'
complete -c qwencloud -n '__fish_seen_subcommand_from support; and not __fish_seen_subcommand_from list view create close reply rate' -a create  -d 'Create ticket'
complete -c qwencloud -n '__fish_seen_subcommand_from support; and not __fish_seen_subcommand_from list view create close reply rate' -a close   -d 'Close ticket'
complete -c qwencloud -n '__fish_seen_subcommand_from support; and not __fish_seen_subcommand_from list view create close reply rate' -a reply   -d 'Reply to ticket'
complete -c qwencloud -n '__fish_seen_subcommand_from support; and not __fish_seen_subcommand_from list view create close reply rate' -a rate    -d 'Rate ticket'
complete -c qwencloud -n '__fish_seen_subcommand_from support; and __fish_seen_subcommand_from list' -l page      -d 'Page number'
complete -c qwencloud -n '__fish_seen_subcommand_from support; and __fish_seen_subcommand_from list' -l page-size -d 'Page size'
complete -c qwencloud -n '__fish_seen_subcommand_from support; and __fish_seen_subcommand_from list view create close reply rate' -l format -d 'Output format' -a 'table json text'
complete -c qwencloud -n '__fish_seen_subcommand_from support; and __fish_seen_subcommand_from close' -l yes     -d 'Skip confirmation'
complete -c qwencloud -n '__fish_seen_subcommand_from support; and __fish_seen_subcommand_from reply'         -l message -d 'Reply message'
complete -c qwencloud -n '__fish_seen_subcommand_from support; and __fish_seen_subcommand_from rate'          -l rating  -d 'Rating'
complete -c qwencloud -n '__fish_seen_subcommand_from support; and __fish_seen_subcommand_from rate'          -l comment -d 'Comment'

# ── workspace subcommands ────────────────────────────────────────────────────
complete -c qwencloud -n '__fish_seen_subcommand_from workspace; and not __fish_seen_subcommand_from list limit' -f
complete -c qwencloud -n '__fish_seen_subcommand_from workspace; and not __fish_seen_subcommand_from list limit' -a list  -d 'List workspaces'
complete -c qwencloud -n '__fish_seen_subcommand_from workspace; and not __fish_seen_subcommand_from list limit' -a limit -d 'View workspace limits'
complete -c qwencloud -n '__fish_seen_subcommand_from workspace; and __fish_seen_subcommand_from list limit' -l format -d 'Output format' -a 'table json text'


# ── update options ───────────────────────────────────────────────────────────
complete -c qwencloud -n '__fish_seen_subcommand_from update' -a '' -d ''

# ── docs view ────────────────────────────────────────────────────────────────
complete -c qwencloud -n '__fish_seen_subcommand_from docs; and __fish_seen_subcommand_from view' -l format -d 'Output format' -a 'table json text'

# ── auth options ─────────────────────────────────────────────────────────────
complete -c qwencloud -n '__fish_seen_subcommand_from login'  -l format    -d 'Output format' -a 'table json text'
complete -c qwencloud -n '__fish_seen_subcommand_from login'  -l init-only -d 'Output device code and exit'
complete -c qwencloud -n '__fish_seen_subcommand_from login'  -l complete  -d 'Resume pending login session'
complete -c qwencloud -n '__fish_seen_subcommand_from login'  -l timeout   -d 'Polling timeout in seconds'
complete -c qwencloud -n '__fish_seen_subcommand_from logout' -l format -d 'Output format' -a 'table json text'
complete -c qwencloud -n '__fish_seen_subcommand_from status' -l format -d 'Output format' -a 'table json text'

# ── doctor options ───────────────────────────────────────────────────────────
complete -c qwencloud -n '__fish_seen_subcommand_from doctor' -l format -d 'Output format' -a 'table json text'

# ── version options ──────────────────────────────────────────────────────────
complete -c qwencloud -n '__fish_seen_subcommand_from version' -l check -d 'Check for updates'

# ── models list format (missing from above) ──────────────────────────────────
complete -c qwencloud -n '__fish_seen_subcommand_from list'   -l format    -d 'Output format' -a 'table json text'

# ── Global options ────────────────────────────────────────────────────────────
complete -c qwencloud -l format -d 'Output format' -a 'table json text'
complete -c qwencloud -s h -l help    -d 'Show help'
complete -c qwencloud -s v -l version -d 'Show version'
`;
}

function generateCompletion(shell: ShellType): string {
  switch (shell) {
    case 'zsh':
      return generateZshCompletion();
    case 'bash':
      return generateBashCompletion();
    case 'fish':
      return generateFishCompletion();
  }
}

export function registerCompletionCommand(program: Command): void {
  const completion = program.command('completion').description('Install shell tab completion');

  completion
    .command('install')
    .description('Install tab completion for your shell')
    .option('--shell <shell>', 'Shell type: bash, zsh, fish')
    .action((opts) => {
      const shell = (opts.shell as ShellType) ?? detectShell();
      if (!shell) {
        console.error('Error: Unable to detect shell. Use --shell <bash|zsh|fish>');
        process.exit(1);
      }

      if (!['zsh', 'bash', 'fish'].includes(shell)) {
        console.error(`Error: Unsupported shell '${shell}'. Supported: bash, zsh, fish`);
        process.exit(1);
      }

      console.log(`Detected shell: ${shell}`);

      const rcPath = getShellRcPath(shell);

      // Check if already installed
      if (existsSync(rcPath)) {
        const content = readFileSync(rcPath, 'utf-8');
        if (content.includes('qwencloud completion generate')) {
          console.log(
            `${theme.success(theme.symbols.pass)}  Completion already installed in ${rcPath}`,
          );
          return;
        }
      }

      const completionLine = getCompletionLine(shell);
      try {
        // Shells like fish keep their rc file under a nested config directory
        // (~/.config/fish) that may not exist yet on a fresh setup; create it
        // so the append does not fail with ENOENT.
        mkdirSync(dirname(rcPath), { recursive: true });
        appendFileSync(rcPath, completionLine);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(`Error: Failed to write completion config to ${rcPath}: ${reason}`);
        process.exit(1);
      }

      const sourceCmd = getSourceCommand(shell);
      console.log(
        `${theme.success(theme.symbols.pass)}  Done! Restart your terminal or run: ${sourceCmd}`,
      );
    });

  completion
    .command('generate')
    .description('Generate completion script')
    .option('--shell <shell>', 'Shell type: bash, zsh, fish')
    .action((opts) => {
      const shell = (opts.shell as ShellType) ?? detectShell();
      if (!shell) {
        console.error('Error: Unable to detect shell. Use --shell <bash|zsh|fish>');
        process.exit(1);
      }

      if (!['zsh', 'bash', 'fish'].includes(shell)) {
        console.error(`Error: Unsupported shell '${shell}'. Supported: bash, zsh, fish`);
        process.exit(1);
      }

      process.stdout.write(generateCompletion(shell));
    });

  completion.action(() => {
    completion.outputHelp();
    process.stdout.write('\n');
  });
}
