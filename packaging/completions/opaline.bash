_opaline() {
  local cur prev words cword
  COMPREPLY=()
  cur="${COMP_WORDS[COMP_CWORD]}"
  prev="${COMP_WORDS[COMP_CWORD-1]}"

  if [[ ${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "ctl --peek --edit --settings --onboarding --safe-mode --diagnose --dump --quit --help --version" -- "${cur}") )
    return 0
  fi

  if [[ ${COMP_WORDS[1]} == "ctl" ]]; then
    if [[ ${COMP_CWORD} -eq 2 ]]; then
      COMPREPLY=( $(compgen -W "status get set widgets profile theme look var action peek edit export import automation completions" -- "${cur}") )
      return 0
    fi
    case "${COMP_WORDS[2]}" in
      widgets)
        COMPREPLY=( $(compgen -W "list add remove move toggle" -- "${cur}") ) ;;
      profile)
        COMPREPLY=( $(compgen -W "list use save delete" -- "${cur}") ) ;;
      look)
        COMPREPLY=( $(compgen -W "glass clear tinted dark light dimmed" -- "${cur}") ) ;;
      theme)
        COMPREPLY=( $(compgen -W "opaline crystal bloom instrument air terminal neon paper mono classic" -- "${cur}") ) ;;
      var)
        COMPREPLY=( $(compgen -W "set" -- "${cur}") ) ;;
      automation)
        COMPREPLY=( $(compgen -W "status resume" -- "${cur}") ) ;;
      completions)
        COMPREPLY=( $(compgen -W "bash zsh fish" -- "${cur}") ) ;;
    esac
  fi
}
complete -F _opaline opaline
