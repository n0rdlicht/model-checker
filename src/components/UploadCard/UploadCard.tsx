import { Button, Divider, Group, rem, Stack, Text } from '@mantine/core'
import { Paper } from '@components'
import { Dropzone, FileRejection } from '@mantine/dropzone'
import { IconFile3d, IconUpload, IconX } from '@tabler/icons-react'
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useValidationContext } from '@context'
import { processFile } from './processFile.ts'
import { useTranslation } from 'react-i18next'
import { UploadCardTitle } from './UploadCardTitle.tsx'

interface FileError {
  code: string
  message: string
  file: string
}

export const UploadCard = () => {
  const navigate = useNavigate()
  const { dispatch } = useValidationContext()
  const [files, setFiles] = useState<File[]>([])
  const [errors, setErrors] = useState<FileError[] | null>(null)
  const { t } = useTranslation()

  const handleClick = () => {
    if (!files.length) return
    files.forEach((file) => {
      processFile({ file: file as File, dispatch, fileId: file.name })
    })
    setFiles([])
    navigate('/results')
  }

  const handleDrop = (acceptedFiles: File[]) => {
    setErrors([])
    setFiles((prevFiles) => [...prevFiles, ...acceptedFiles])
  }

  const handleReject = (fileRejections: FileRejection[]) => {
    setErrors(fileRejections.map((rejection) => ({ ...rejection.errors[0], file: rejection.file.name })))
  }

  // Custom validator to check for .ifc file extension
  const fileValidator = (file: File) => {
    const validExtension = file.name.endsWith('.ifc')
    if (!validExtension) {
      return {
        code: 'file-invalid-type',
        message: t('dropzone.error'),
      }
    }
    return null
  }

  return (
    <Stack>
      <Paper>
        <UploadCardTitle />
        <Divider py={8} />
        <Stack maw={650} mb='md' gap='xs'>
          <Text size='sm'>{t('upload-description.0')}</Text>
          <Text size='sm'>{t('upload-description.1')}</Text>
          <Text size='sm'>{t('upload-description.2')}</Text>
          <Text size='sm' fw={700}>
            {t('upload-description.3')}
          </Text>
          <Text size='sm'>{t('upload-description.4')}</Text>
        </Stack>
        <Dropzone
          onDrop={handleDrop}
          onReject={handleReject}
          maxSize={500 * 1024 ** 2}
          multiple={true}
          validator={fileValidator}
        >
          <Group justify='center' gap='xl' mih={220} style={{ pointerEvents: 'none' }}>
            <Dropzone.Accept>
              <IconUpload
                style={{ width: rem(52), height: rem(52), color: 'var(--mantine-color-blue-6)' }}
                stroke={1.5}
              />
            </Dropzone.Accept>
            <Dropzone.Reject>
              <IconX style={{ width: rem(52), height: rem(52), color: 'var(--mantine-color-red-6)' }} stroke={1.5} />
            </Dropzone.Reject>
            <Dropzone.Idle>
              <IconFile3d
                style={{ width: rem(52), height: rem(52), color: 'var(--mantine-color-dimmed)' }}
                stroke={1.5}
              />
            </Dropzone.Idle>

            <Stack maw={500} gap='xs'>
              <Text size='xl'>{t('dropzone.drag')}</Text>
              <Text size='sm' c='dimmed' mt={7}>
                {t('dropzone.attach')}
              </Text>
            </Stack>
          </Group>
          <div>
            {files?.map((file, index) => (
              <Group key={index}>
                <IconFile3d stroke={0.7} />
                <Text size='sm'>{file.name}</Text>
              </Group>
            ))}
          </div>
          {errors ? (
            <div>
              {errors.map((error) => (
                <Text size='sm' c='red'>
                  {t('dropzone.error-message')}: {error.file} - {error.message}
                </Text>
              ))}
            </div>
          ) : null}
        </Dropzone>
        <Button mt='md' onClick={handleClick} disabled={!files.length}>
          {t('validate')}
        </Button>
      </Paper>
    </Stack>
  )
}
